import "server-only";
import { and, desc, eq, gt, gte, ilike, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  alerts,
  billingMismatches,
  billingStatus,
  billingSyncRuns,
  customers,
  diagnosticFindings,
  firewallRuleHits,
  firewallSnapshots,
  diagnosticPolicy,
  diagnosticRuns,
  oltOnus,
  olts,
  routers,
  runsnetCustomers,
  runsnetInvoices,
  syslogEvents,
} from "@/db/schema";
import {
  AUTO_PRIORITY,
  LOG_LOOKBACK_MS,
  MANUAL_PRIORITY,
  addressListMembership,
  alertTriggerReason,
  analyzeLog,
  auditRules,
  autoDedupeKey,
  createDiagnosticQueue,
  diagnosticLayers,
  evaluateAddressLists,
  evaluateArrears,
  evaluateBilling,
  evaluateBillingNetwork,
  evaluateConntrack,
  evaluateCustomerConnections,
  evaluateFasttrack,
  evaluateFilterBlock,
  evaluateMangle,
  evaluatePortForward,
  evaluateRaw,
  evaluateSrcNat,
  evaluateStaleRules,
  evaluateIpConflict,
  evaluateOnt,
  evaluateOptical,
  evaluatePonVlan,
  evaluatePppInterface,
  evaluatePppoe,
  evaluateQueue,
  evaluateRunsnetStatus,
  logLineMatcher,
  parseRouterLogTime,
  pendingLayer,
  pickVerdict,
  sharedDedupeKey,
  unchecked,
  type DiagnosticLayer,
  type DiagnosticPolicyDto,
  type DiagnosticRunDto,
  type Finding,
  type FindingDto,
  type FirewallTable,
  type LogLine,
  type RuleHit,
  type Ros,
  type TimelineEvent,
} from "@/lib/diagnostics";
import { GenieAcsClient } from "@/lib/genieacs/client";
import { getGenieacsConfig } from "@/lib/genieacs/config";
import { parseDeviceDetail } from "@/lib/genieacs/device-detail";
import { MikrotikRestClient } from "@/lib/mikrotik/client";
import { getRouterDecryptedCredentials } from "@/services/device-credentials.service";
import type { DiagnosticPolicyInput } from "@/validators/diagnostics";

// Mesin diagnosa pelanggan berlapis. Tombol manual dan pemicu otomatis memakai
// executeRun yang sama; yang beda hanya trigger_mode dan alasannya. Semua
// pembacaan hanya-baca: tidak ada yang ditulis ke router, OLT, atau ONT.

type CustomerTarget = {
  id: string;
  name: string;
  pppoeUsername: string;
  routerId: string;
  routerName: string;
  routerStatus: string;
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function loadCustomer(customerId: string): Promise<CustomerTarget | null> {
  const [row] = await db
    .select({
      id: customers.id,
      name: customers.name,
      pppoeUsername: customers.pppoeUsername,
      routerId: customers.routerId,
      routerName: routers.name,
      routerStatus: routers.status,
    })
    .from(customers)
    .innerJoin(routers, eq(routers.id, customers.routerId))
    .where(eq(customers.id, customerId))
    .limit(1);
  return row ?? null;
}

type Read<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

async function attempt<T>(fn: () => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: message(err) };
  }
}

const rows = (r: Read | undefined): Ros[] =>
  r?.ok && Array.isArray(r.value) ? (r.value as Ros[]) : [];
const firstRow = (r: Read | undefined) => rows(r)[0] ?? null;
// Galat pertama di antara beberapa pembacaan, atau null bila semuanya berhasil.
const failed = (...reads: (Read | undefined)[]) =>
  reads.find((r): r is { ok: false; error: string } => !!r && !r.ok)?.error ?? null;

const FIREWALL_TABLES: FirewallTable[] = ["filter", "raw", "nat", "mangle"];

// Jarak dua sampel penghitung (byte, drop, error) untuk menghitung laju.
const SAMPLE_GAP_MS = 2_000;
// Address-list sebesar ini tidak dibaca utuh ke memori; tandai tidak terperiksa.
const MAX_ADDRESS_LIST = 20_000;

interface RouterSnapshot {
  source: string;
  readAt: Date;
  // Router tidak bisa dibaca sama sekali; semua lapisan router "tidak dapat diperiksa".
  error: string | null;
  session: Ros | null;
  iface: string;
  gapSec: number;
  reads: Record<string, Read>;
  membership: ReturnType<typeof addressListMembership> | null;
  // Buffer log memori router; dibaca hanya bila syslog tersimpan tidak mengalir.
  readLog: (() => Promise<Read>) | null;
  // Audit firewall (Fase 4); kosong bila IP/address-list/rule tidak terbaca.
  firewall: { hits: RuleHit[]; fasttrack: boolean; outbound: Ros[]; inbound: Ros[] } | null;
}

// Satu pembacaan router per diagnosa, dipakai lapisan MikroTik, Firewall, dan
// Billing. Semua GET, berurutan (bukan paralel) supaya layanan www router
// produksi tidak dibanjiri.
async function readRouter(c: CustomerTarget): Promise<RouterSnapshot> {
  const snapshot: RouterSnapshot = {
    source: `Router ${c.routerName}`,
    readAt: new Date(),
    error: null,
    session: null,
    iface: `<pppoe-${c.pppoeUsername}>`,
    gapSec: 0,
    reads: {},
    membership: null,
    readLog: null,
    firewall: null,
  };
  if (c.routerStatus !== "aktif") {
    return { ...snapshot, error: `router berstatus "${c.routerStatus}", tidak dipoll` };
  }
  const creds = await getRouterDecryptedCredentials(c.routerId);
  if (!creds) return { ...snapshot, error: "kredensial router tidak ditemukan" };
  const client = new MikrotikRestClient({
    host: creds.host,
    port: creds.port,
    username: creds.username,
    password: creds.password,
    useSsl: creds.useTls,
    mode: "real",
  });
  const { reads } = snapshot;
  snapshot.readLog = () => attempt(() => client.read("/rest/log"));
  const read = async (key: string, path: string, filter?: Record<string, string>) => {
    reads[key] = await attempt(() => client.read(path, filter));
  };

  await read("active", "/rest/ppp/active");
  if (!reads.active.ok) return { ...snapshot, error: reads.active.error };
  const wanted = c.pppoeUsername.toLowerCase().trim();
  const session = rows(reads.active).find((s) => (s.name ?? "").toLowerCase().trim() === wanted) ?? null;
  await read("tracking", "/rest/ip/firewall/connection/tracking");
  snapshot.readAt = new Date();
  if (!session) return snapshot;

  snapshot.session = session;
  const iface = `<pppoe-${session.name}>`;
  snapshot.iface = iface;
  const t1 = Date.now();
  await read("queue1", "/rest/queue/simple", { name: iface });
  await read("ppp1", "/rest/interface", { name: iface });
  await read("binding", "/rest/interface/pppoe-server", { name: iface });
  const vlanName = firstRow(reads.binding)?.interface || null;
  if (vlanName) {
    await read("vlan1", "/rest/interface", { name: vlanName });
    await read("vlanDef", "/rest/interface/vlan", { name: vlanName });
  }
  if (session.address) {
    await read("arp", "/rest/ip/arp", { address: session.address });
    await read("lease", "/rest/ip/dhcp-server/lease", { address: session.address });
    await read("addressList", "/rest/ip/firewall/address-list");
    const entries = rows(reads.addressList);
    if (reads.addressList.ok && entries.length <= MAX_ADDRESS_LIST) {
      snapshot.membership = addressListMembership(session.address, entries);
    }
    // Konfigurasi firewall dan koneksi pelanggan (proplist: hanya kolom yang dinilai).
    for (const table of FIREWALL_TABLES) await read(`fw_${table}`, `/rest/ip/firewall/${table}`);
    const props = { ".proplist": "fasttrack,connection-mark,protocol" };
    await read("connOut", "/rest/ip/firewall/connection", { "src-address": session.address, ...props });
    await read("connIn", "/rest/ip/firewall/connection", { "dst-address": session.address, ...props });
    if (snapshot.membership && !failed(...FIREWALL_TABLES.map((t) => reads[`fw_${t}`]), reads.connOut, reads.connIn)) {
      const hits = auditRules(
        Object.fromEntries(FIREWALL_TABLES.map((t) => [t, rows(reads[`fw_${t}`])])),
        { ip: session.address, iface, lists: snapshot.membership.lists },
      );
      const outbound = rows(reads.connOut);
      const inbound = rows(reads.connIn);
      snapshot.firewall = {
        hits,
        outbound,
        inbound,
        fasttrack: evaluateFasttrack(hits, [...outbound, ...inbound], "", new Date()).status === "fail",
      };
    }
  }
  const wait = SAMPLE_GAP_MS - (Date.now() - t1);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const t2 = Date.now();
  await read("queue2", "/rest/queue/simple", { name: iface });
  await read("ppp2", "/rest/interface", { name: iface });
  if (vlanName) await read("vlan2", "/rest/interface", { name: vlanName });
  snapshot.gapSec = (t2 - t1) / 1000;
  snapshot.readAt = new Date();
  return snapshot;
}

async function readMikrotik(c: CustomerTarget, ctx: RunContext): Promise<Finding[]> {
  const s = await ctx.router();
  const pppoe = evaluatePppoe({
    routerName: c.routerName,
    username: c.pppoeUsername,
    readAt: s.readAt,
    error: s.error,
    session: s.session
      ? { address: s.session.address ?? "", uptime: s.session.uptime ?? "", callerId: s.session["caller-id"] ?? "" }
      : null,
  });
  if (s.error || !s.session) {
    return [
      pppoe,
      unchecked(
        "mikrotik",
        "sesi_detail",
        "Queue, antarmuka, jalur PON, bentrok IP",
        s.error ? "Router tidak terbaca." : "Sesi PPPoE tidak aktif: queue dan antarmuka dinamis pelanggan tidak ada.",
        s.source,
      ),
    ];
  }
  const { reads, gapSec, readAt: at } = s;
  const out: Finding[] = [pppoe];

  const qErr = failed(reads.queue1, reads.queue2);
  out.push(
    ...(qErr
      ? [unchecked("mikrotik", "queue_limit", "Simple queue pelanggan", `Gagal membaca /queue/simple: ${qErr}`, s.source)]
      : evaluateQueue(firstRow(reads.queue1), firstRow(reads.queue2), gapSec, `${s.source} · /queue/simple ${s.iface}`, at).map(
          // PRD: fasttrack diperiksa sebelum menyimpulkan soal queue.
          (f): Finding =>
            s.firewall?.fasttrack && f.status === "ok"
              ? { ...f, status: "warn", detail: `Fasttrack aktif: batas ini TIDAK dieksekusi untuk koneksi yang di-fasttrack. ${f.detail}` }
              : f,
        )),
  );

  const pErr = failed(reads.ppp1, reads.ppp2);
  out.push(
    pErr
      ? unchecked("mikrotik", "iface_errors", "Error & drop antarmuka PPPoE", `Gagal membaca /interface: ${pErr}`, s.source)
      : evaluatePppInterface(firstRow(reads.ppp1), firstRow(reads.ppp2), gapSec, `${s.source} · /interface ${s.iface}`, at),
  );

  const vlanName = firstRow(reads.binding)?.interface || null;
  const vErr = failed(reads.binding, reads.vlan1, reads.vlan2);
  out.push(
    vErr
      ? unchecked("mikrotik", "pon_vlan_rate", "Laju jalur PON", `Gagal membaca antarmuka asal sesi: ${vErr}`, s.source)
      : evaluatePonVlan(vlanName, firstRow(reads.vlan1), firstRow(reads.vlan2), gapSec, `${s.source} · /interface ${vlanName ?? "—"}`, at),
  );

  const ip = s.session.address ?? "";
  const aErr = failed(reads.arp, reads.lease);
  out.push(
    !ip
      ? unchecked("mikrotik", "ip_conflict", "Bentrok alamat (ARP/DHCP)", "Sesi tidak punya alamat IP.", s.source)
      : aErr
        ? unchecked("mikrotik", "ip_conflict", "Bentrok alamat (ARP/DHCP)", `Gagal membaca ARP/DHCP: ${aErr}`, s.source)
        : evaluateIpConflict(ip, s.iface, rows(reads.arp), rows(reads.lease), `${s.source} · /ip/arp, /ip/dhcp-server/lease`, at),
  );
  return out;
}

async function readFirewall(c: CustomerTarget, ctx: RunContext): Promise<Finding[]> {
  const s = await ctx.router();
  if (s.error) {
    return [unchecked("firewall", "ringkasan", "Firewall, NAT & connection tracking", `Router tidak terbaca: ${s.error}`, s.source)];
  }
  const out: Finding[] = [];
  const ip = s.session?.address;
  if (!ip) {
    out.push(unchecked("firewall", "address_list", "Address-list yang memuat IP pelanggan", "Sesi PPPoE tidak aktif: IP pelanggan tidak diketahui.", s.source));
  } else if (!s.membership) {
    out.push(
      unchecked(
        "firewall",
        "address_list",
        "Address-list yang memuat IP pelanggan",
        failed(s.reads.addressList)
          ? `Gagal membaca address-list: ${failed(s.reads.addressList)}`
          : `Address-list lebih dari ${MAX_ADDRESS_LIST} entri, tidak dibaca utuh.`,
        s.source,
      ),
    );
  } else {
    out.push(evaluateAddressLists(ip, s.membership, `${s.source} · /ip/firewall/address-list`, s.readAt));
  }
  const t = s.reads.tracking;
  out.push(
    t?.ok && t.value && typeof t.value === "object" && !Array.isArray(t.value)
      ? evaluateConntrack(t.value as Ros, `${s.source} · /ip/firewall/connection/tracking`, s.readAt)
      : unchecked("firewall", "conntrack", "Tabel connection tracking", `Gagal membaca connection tracking${failed(t) ? `: ${failed(t)}` : ""}.`, s.source),
  );
  out.push(...(await auditFirewall(c, ctx, s)));
  return out;
}

// Audit rule (Fase 4) dan simpan potretnya ke firewall_snapshots/_rule_hits.
async function auditFirewall(c: CustomerTarget, ctx: RunContext, s: RouterSnapshot): Promise<Finding[]> {
  const label = "Audit rule firewall & NAT";
  const ip = s.session?.address;
  if (!ip) {
    return [unchecked("firewall", "audit", label, "Sesi PPPoE tidak aktif: IP pelanggan tidak diketahui, rule tidak bisa dicocokkan.", s.source)];
  }
  if (!s.firewall) {
    const err = failed(...FIREWALL_TABLES.map((t) => s.reads[`fw_${t}`]), s.reads.connOut, s.reads.connIn);
    return [
      unchecked(
        "firewall",
        "audit",
        label,
        err ? `Gagal membaca firewall: ${err}` : "Address-list tidak terbaca utuh, keanggotaan pelanggan tidak diketahui.",
        s.source,
      ),
    ];
  }
  const { hits, outbound, inbound } = s.firewall;
  const ref = `${s.source} · /ip/firewall/{filter,raw,nat,mangle}`;
  const at = s.readAt;
  const t = s.reads.tracking;
  const tracking = t?.ok && t.value && typeof t.value === "object" && !Array.isArray(t.value) ? (t.value as Ros) : null;
  const connections = [...outbound, ...inbound];
  const findings = [
    evaluateFasttrack(hits, connections, `${ref}, /ip/firewall/connection`, at),
    evaluateFilterBlock(hits, ref, at),
    evaluateRaw(hits, ref, at),
    evaluateSrcNat(hits, ip, ref, at),
    evaluatePortForward(hits, rows(s.reads.fw_nat), ip, ref, at),
    evaluateMangle(hits, firstRow(s.reads.queue2) ?? firstRow(s.reads.queue1), connections, ref, at),
    evaluateCustomerConnections(outbound, inbound, tracking, `${s.source} · /ip/firewall/connection`, at),
    evaluateStaleRules(hits, ref, at),
  ];
  const [snap] = await db
    .insert(firewallSnapshots)
    .values({
      runId: ctx.runId,
      routerId: c.routerId,
      customerId: c.id,
      takenAt: at,
      customerIp: ip,
      fasttrackActive: s.firewall.fasttrack,
      conntrackCount: connections.length,
      conntrackTotal: tracking ? Number(tracking["total-entries"]) || null : null,
      conntrackMax: tracking ? Number(tracking["max-entries"]) || null : null,
      rawDropMatched: hits.some((h) => h.table === "raw" && !h.disabled && ["drop", "reject"].includes(h.action)),
      addressListMatched: s.membership?.lists ?? [],
    })
    .returning({ id: firewallSnapshots.id });
  if (hits.length) {
    await db.insert(firewallRuleHits).values(
      hits.map((h) => ({
        snapshotId: snap.id,
        table: h.table,
        chain: h.chain,
        ruleIndex: h.index,
        ruleId: h.ruleId,
        action: h.action,
        scope: h.scope,
        summary: h.summary,
        comment: h.comment,
        disabled: h.disabled,
        matchedPackets: h.packets,
        matchedBytes: h.bytes,
        isStale: h.stale,
      })),
    );
  }
  return findings;
}

type OnuRow = {
  oltName: string;
  ponIndex: number;
  onuIndex: number;
  status: string;
  rxPower: number | null;
  capturedAt: Date;
};

async function readOnu(customerId: string): Promise<OnuRow | null> {
  const [onu] = await db
    .select({
      oltName: olts.name,
      ponIndex: oltOnus.ponIndex,
      onuIndex: oltOnus.onuIndex,
      status: oltOnus.status,
      rxPower: oltOnus.rxPower,
      capturedAt: oltOnus.capturedAt,
    })
    .from(oltOnus)
    .innerJoin(olts, eq(olts.id, oltOnus.oltId))
    .where(eq(oltOnus.customerId, customerId))
    .limit(1);
  return onu ?? null;
}

async function readOnt(c: CustomerTarget, ctx: RunContext): Promise<Finding[]> {
  const config = getGenieacsConfig();
  if (config.mode === "simulator") {
    return [
      unchecked("ont", "ont_found", "Modem di GenieACS", "GenieACS berjalan dalam mode simulator (bukan DASHBOARD_DATA=live): tidak ada data modem nyata.", "GenieACS"),
    ];
  }
  const client = new GenieAcsClient(config);
  const wanted = c.pppoeUsername.toLowerCase().trim();
  // Cepat lewat query WANPPPConnection.1; cadangan: cocokkan semua WAN seperti halaman CPE.
  const deviceId =
    (await client.findDeviceIdByPppoe(c.pppoeUsername)) ??
    (await client.listDevices()).find((d) => d.pppoeUsername.trim().toLowerCase() === wanted)?.deviceId ??
    null;
  const raw = deviceId ? await client.getRawDevice(deviceId) : null;
  const d = raw ? parseDeviceDetail(raw) : null;
  const onu = await ctx.onu();
  return evaluateOnt(
    d && {
      deviceId: d.deviceId,
      lastInform: d.lastInform,
      uptimeSeconds: d.uptimeSeconds,
      activeClients: d.activeClients,
      rxDbm: d.optical.rxDbm,
      wans: d.wans,
    },
    c.pppoeUsername,
    onu?.rxPower ?? null,
    new Date(),
  );
}

const todayWib = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());

// Ketidakcocokan hasil sinkron billing backend Go (billing_mismatches).
async function readGoMismatches(customerId: string): Promise<Finding> {
  const label = "Ketidaksesuaian sinkron billing";
  const [run] = await db
    .select({ id: billingSyncRuns.id, finishedAt: billingSyncRuns.finishedAt })
    .from(billingSyncRuns)
    .where(eq(billingSyncRuns.status, "success"))
    .orderBy(desc(billingSyncRuns.finishedAt))
    .limit(1);
  if (!run) {
    return unchecked("billing", "billing_mismatch", label, "Sinkron billing backend Go belum pernah berhasil, jadi billing_mismatches kosong. Kecocokan dicek lewat RunsNet ↔ router.", "billing_sync_runs");
  }
  const found = await db
    .select({ reason: billingMismatches.reason, invoiceName: billingMismatches.invoiceName })
    .from(billingMismatches)
    .where(and(eq(billingMismatches.runId, run.id), sql`${billingMismatches.customerIds} @> array[${customerId}]::uuid[]`));
  return {
    layer: "billing",
    metric: "billing_mismatch",
    label,
    value: found.length ? `${found.length} tagihan` : "tidak ada",
    threshold: "0",
    comparator: "=",
    status: found.length ? "warn" : "ok",
    detail: found.length
      ? `Tagihan bertabrakan dengan pelanggan ini: ${found.map((f) => `${f.invoiceName} (${f.reason})`).join(", ")}.`
      : "Tidak ada tagihan yang bertabrakan dengan pelanggan ini.",
    sourceRef: `billing_mismatches · sinkron ${run.finishedAt?.toISOString() ?? "—"}`,
    sampledAt: run.finishedAt,
  };
}

async function readBilling(c: CustomerTarget, ctx: RunContext): Promise<Finding[]> {
  // ID RunsNet = username PPPoE tanpa "@domain" (sama dengan halaman detail pelanggan).
  const custId = c.pppoeUsername.split("@")[0].trim();
  const [rn] = await db
    .select({
      custId: runsnetCustomers.custId,
      status: runsnetCustomers.status,
      connectivity: runsnetCustomers.connectivity,
      syncedAt: runsnetCustomers.syncedAt,
    })
    .from(runsnetCustomers)
    .where(eq(runsnetCustomers.custId, custId))
    .limit(1);
  const [bs] = await db
    .select({ status: billingStatus.status, syncedAt: billingStatus.syncedAt, billingName: billingStatus.billingName })
    .from(billingStatus)
    .where(eq(billingStatus.customerId, c.id))
    .limit(1);

  const out: Finding[] = [rn ? evaluateRunsnetStatus(rn) : evaluateBilling(bs ?? null)];
  if (rn) {
    const invoices = await db
      .select({ dueDate: runsnetInvoices.dueDate, status: runsnetInvoices.status, remainingAmount: runsnetInvoices.remainingAmount })
      .from(runsnetInvoices)
      .where(and(eq(runsnetInvoices.custId, custId), ne(runsnetInvoices.status, "paid")));
    out.push(evaluateArrears(invoices, todayWib(), `RunsNet · tagihan ID ${custId}`, rn.syncedAt));
  } else {
    out.push(unchecked("billing", "arrears", "Tagihan lewat jatuh tempo", `ID ${custId} tidak ada di data RunsNet.`, "RunsNet"));
  }
  const s = await ctx.router();
  out.push(
    evaluateBillingNetwork({
      billingStatus: rn?.status ?? (bs ? (bs.status === "isolir" ? "Isolir" : "Active") : null),
      sessionActive: s.error ? null : s.session !== null,
      isolatedInRouter: s.membership ? s.membership.isolated : null,
      sourceRef: `${rn ? "RunsNet" : "billing_status"} ↔ ${s.source} address-list`,
      sampledAt: s.readAt,
    }),
  );
  out.push(await readGoMismatches(c.id));
  return out;
}

type RunContext = {
  runId: string;
  router: () => Promise<RouterSnapshot>;
  onu: () => Promise<OnuRow | null>;
  complaintAt: Date;
  timeline: TimelineEvent[];
};

function memo<T>(fn: () => Promise<T>) {
  let p: Promise<T> | undefined;
  return () => (p ??= fn());
}

// Syslog tersimpan dianggap mengalir bila baris terbaru router lebih muda dari ini.
const SYSLOG_FRESH_MS = 15 * 60_000;
// shortcut: batas baris per diagnosa; pelanggan yang sangat flapping bisa
// melewatinya, cukup untuk menilai (angkanya tetap jauh di atas ambang).
const MAX_LOG_ROWS = 5_000;

const fmtWib = (d: Date) =>
  new Intl.DateTimeFormat("id-ID", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Jakarta" }).format(d);
const likeTerm = (s: string) => `%${s.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;

// Log router untuk pelanggan: syslog tersimpan bila mengalir; bila tidak,
// buffer memori router (/log) dengan cakupan yang dinyatakan apa adanya.
async function readLog(c: CustomerTarget, ctx: RunContext): Promise<Finding[]> {
  const s = await ctx.router();
  const session = s.session;
  const vlan = firstRow(s.reads.binding)?.interface || null;
  const parent = firstRow(s.reads.vlanDef)?.interface || null;
  const target = {
    username: session?.name || c.pppoeUsername,
    mac: session?.["caller-id"] || null,
    ip: session?.address && session.address !== "0.0.0.0" ? session.address : null,
    interfaces: [vlan, parent].filter((x): x is string => !!x),
  };
  const matches = logLineMatcher(target);
  const now = new Date();

  const [stat] = await db
    .select({
      newest: sql<string | null>`max(${syslogEvents.receivedAt})`,
      oldest: sql<string | null>`min(${syslogEvents.receivedAt})`,
    })
    .from(syslogEvents)
    .where(eq(syslogEvents.routerId, c.routerId));
  const newest = stat?.newest ? new Date(stat.newest) : null;

  let result: ReturnType<typeof analyzeLog>;
  if (newest && now.getTime() - newest.getTime() < SYSLOG_FRESH_MS) {
    const from = new Date(ctx.complaintAt.getTime() - LOG_LOOKBACK_MS);
    const terms = [target.username, target.mac, target.ip, ...target.interfaces.map((i) => `${i} link`)].filter(
      (x): x is string => !!x,
    );
    const lines = await db
      .select({ at: syslogEvents.receivedAt, topics: syslogEvents.topics, message: syslogEvents.message })
      .from(syslogEvents)
      .where(
        and(
          eq(syslogEvents.routerId, c.routerId),
          gte(syslogEvents.receivedAt, from),
          or(...terms.map((t) => ilike(syslogEvents.message, likeTerm(t)))),
        ),
      )
      .orderBy(syslogEvents.receivedAt)
      .limit(MAX_LOG_ROWS);
    result = analyzeLog({
      lines,
      matches,
      complaintAt: ctx.complaintAt,
      now,
      coverageStart: stat?.oldest ? new Date(stat.oldest) : null,
      sourceLabel: `Syslog tersimpan dari router ${c.routerName}`,
      sourceRef: `syslog_events · ${c.routerName}`,
      coverageHint: "Syslog tersimpan masih baru; cakupannya bertambah seiring waktu sampai batas retensi.",
    });
  } else {
    const why = newest ? `syslog terakhir diterima ${fmtWib(newest)}` : "belum pernah ada syslog diterima";
    if (s.error || !s.readLog) {
      return [
        unchecked("log", "log_coverage", "Cakupan log", `Syslog remote tidak mengalir ke NOC (${why}) dan router tidak terbaca${s.error ? `: ${s.error}` : ""}.`, s.source),
      ];
    }
    const mem = await s.readLog();
    if (!mem.ok) {
      return [unchecked("log", "log_coverage", "Cakupan log", `Syslog remote tidak mengalir (${why}); buffer log router gagal dibaca: ${mem.error}`, s.source)];
    }
    const lines = rows(mem)
      .map((e) => ({ at: parseRouterLogTime(e.time ?? "", now), topics: e.topics ?? "", message: e.message ?? "" }))
      .filter((l): l is LogLine => l.at !== null);
    result = analyzeLog({
      lines,
      matches,
      complaintAt: ctx.complaintAt,
      now,
      coverageStart: lines[0]?.at ?? null,
      sourceLabel: `Buffer memori router ${c.routerName} (${lines.length} baris terakhir; ${why})`,
      sourceRef: `${s.source} · /log (jam router WIB)`,
      coverageHint: "Aktifkan syslog remote router ke NOC.",
    });
  }
  ctx.timeline.push(...result.timeline);
  return result.findings;
}

const alertKindText: Record<string, string> = {
  offline: "pelanggan offline",
  optical: "sinyal optik ONU",
  queue: "antrean penuh",
};

// Alert pelanggan di sekitar keluhan, untuk garis waktu.
async function alertTimeline(customerId: string, complaintAt: Date): Promise<TimelineEvent[]> {
  const list = await db
    .select({ type: alerts.type, severity: alerts.severity, title: alerts.title, startedAt: alerts.startedAt, endedAt: alerts.endedAt })
    .from(alerts)
    .where(and(eq(alerts.customerId, customerId), gte(alerts.startedAt, new Date(complaintAt.getTime() - LOG_LOOKBACK_MS))))
    .orderBy(alerts.startedAt)
    .limit(50);
  return list.flatMap((a) => {
    const what = alertKindText[a.type] ?? a.type;
    const start: TimelineEvent = {
      at: a.startedAt.toISOString(),
      kind: "alert",
      label: `Alert ${what} mulai`,
      detail: a.title ?? `Tingkat ${a.severity}`,
      source: "alerts",
    };
    return a.endedAt
      ? [start, { ...start, at: a.endedAt.toISOString(), kind: "alert_end", label: `Alert ${what} selesai` }]
      : [start];
  });
}

// Satu langkah per lapisan, urut hulu ke hilir (sama dengan diagnosticLayers).
const steps: Record<DiagnosticLayer, (c: CustomerTarget, ctx: RunContext) => Promise<Finding[]>> = {
  hulu: async () => [pendingLayer("hulu", "Utilisasi uplink, kualitas jalur hulu, BGP, IPv6")],
  mikrotik: readMikrotik,
  log: readLog,
  firewall: readFirewall,
  optik: async (_c, ctx) => [evaluateOptical(await ctx.onu(), new Date())],
  ont: readOnt,
  trafik: async () => [pendingLayer("trafik", "Tren trafik pelanggan dan aliran NetFlow")],
  billing: readBilling,
};

async function executeRun(runId: string) {
  const [run] = await db
    .update(diagnosticRuns)
    .set({ status: "running", startedAt: new Date() })
    .where(and(eq(diagnosticRuns.id, runId), eq(diagnosticRuns.status, "queued")))
    .returning();
  if (!run) return;
  try {
    const c = run.customerId ? await loadCustomer(run.customerId) : null;
    if (!c) throw new Error("Pelanggan tidak ditemukan.");
    const all: Finding[] = [];
    const complaintAt = run.complaintAt ?? run.createdAt;
    const ctx: RunContext = {
      runId,
      router: memo(() => readRouter(c)),
      onu: memo(() => readOnu(c.id)),
      complaintAt,
      timeline: [],
    };
    for (const layer of diagnosticLayers) {
      let found: Finding[];
      try {
        found = await steps[layer.id](c, ctx);
      } catch (err) {
        found = [unchecked(layer.id, "galat", layer.label, `Gagal membaca lapisan: ${message(err)}`)];
      }
      all.push(...found);
      // Ditulis per lapisan supaya tampilan bisa menunjukkan progres.
      await db.insert(diagnosticFindings).values(found.map((f) => ({ ...f, runId })));
    }
    const verdict = pickVerdict(all);
    await db
      .update(diagnosticRuns)
      .set({
        status: "done",
        finishedAt: new Date(),
        verdictLayer: verdict.layer,
        verdictDetail: verdict.detail,
        timeline: [...ctx.timeline, ...(await alertTimeline(c.id, complaintAt))].sort((a, b) =>
          a.at.localeCompare(b.at),
        ),
      })
      .where(eq(diagnosticRuns.id, runId));
  } catch (err) {
    await db
      .update(diagnosticRuns)
      .set({ status: "failed", finishedAt: new Date(), error: message(err) })
      .where(eq(diagnosticRuns.id, runId));
  }
}

const g = globalThis as unknown as {
  nocDiagnosticQueue?: ReturnType<typeof createDiagnosticQueue>;
  nocDiagnosticTrigger?: ReturnType<typeof setInterval>;
};
const queue = () => (g.nocDiagnosticQueue ??= createDiagnosticQueue(executeRun));

// Tombol manual. Bila run manual pelanggan ini masih berjalan, kembalikan run
// itu (reused) alih-alih memulai yang baru.
export async function startManualDiagnostic(
  customerId: string,
  user: { id: string; name: string },
  complaintAt: Date | null = null,
): Promise<{ run: DiagnosticRunDto; reused: boolean } | null> {
  const c = await loadCustomer(customerId);
  if (!c) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const [created] = await db
      .insert(diagnosticRuns)
      .values({
        customerId,
        routerId: c.routerId,
        triggerMode: "manual",
        triggeredBy: user.name,
        triggeredByUserId: user.id,
        triggerReason: "manual",
        complaintAt,
        priority: MANUAL_PRIORITY,
      })
      .onConflictDoNothing()
      .returning({ id: diagnosticRuns.id });
    if (created) {
      queue().enqueue({ runId: created.id, routerKey: c.routerId, priority: MANUAL_PRIORITY });
      return { run: (await getDiagnosticRun(created.id))!, reused: false };
    }
    const [running] = await db
      .select({ id: diagnosticRuns.id })
      .from(diagnosticRuns)
      .where(
        and(
          eq(diagnosticRuns.customerId, customerId),
          eq(diagnosticRuns.triggerMode, "manual"),
          inArray(diagnosticRuns.status, ["queued", "running"]),
        ),
      )
      .limit(1);
    // Kosong = run itu baru saja selesai di antara dua query; coba sisipkan lagi.
    if (running) return { run: (await getDiagnosticRun(running.id))!, reused: true };
  }
  throw new Error("Gagal memulai diagnosa manual.");
}

export async function getDiagnosticPolicy(): Promise<DiagnosticPolicyDto> {
  let [p] = await db.select().from(diagnosticPolicy).where(eq(diagnosticPolicy.id, 1));
  if (!p) {
    // Baris bawaan ditanam migrasi 0033; ini hanya bila baris itu terhapus.
    await db.insert(diagnosticPolicy).values({ id: 1 }).onConflictDoNothing();
    [p] = await db.select().from(diagnosticPolicy).where(eq(diagnosticPolicy.id, 1));
  }
  return {
    triggerAlert: p.triggerAlert,
    triggerTicket: p.triggerTicket,
    triggerBilling: p.triggerBilling,
    dedupeMinutes: p.dedupeMinutes,
    massThreshold: p.massThreshold,
    massWindowMinutes: p.massWindowMinutes,
    updatedBy: p.updatedBy,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function updateDiagnosticPolicy(
  input: DiagnosticPolicyInput,
  updatedBy: string,
): Promise<DiagnosticPolicyDto> {
  await db
    .insert(diagnosticPolicy)
    .values({ id: 1, ...input, updatedBy })
    .onConflictDoUpdate({
      target: diagnosticPolicy.id,
      set: { ...input, updatedBy, updatedAt: new Date() },
    });
  return getDiagnosticPolicy();
}

const reasonEnabled = (reason: string, p: DiagnosticPolicyDto) =>
  reason.startsWith("alert_")
    ? p.triggerAlert
    : reason === "ticket"
      ? p.triggerTicket
      : reason === "billing_isolir"
        ? p.triggerBilling
        : false;

// Satu catatan gangguan bersama per jendela, menggantikan diagnosa individual.
async function recordSharedFault(affected: number, p: DiagnosticPolicyDto) {
  const now = new Date();
  const detail = `${affected} pelanggan terkena alert baru dalam ${p.massWindowMinutes} menit terakhir (ambang ${p.massThreshold}). Diagnosa otomatis per pelanggan ditahan; periksa uplink, router, atau OLT yang dipakai bersama.`;
  const [row] = await db
    .insert(diagnosticRuns)
    .values({
      triggerMode: "auto",
      triggerReason: "shared_fault",
      dedupeKey: sharedDedupeKey(now.getTime(), p.massWindowMinutes),
      priority: AUTO_PRIORITY,
      status: "done",
      startedAt: now,
      finishedAt: now,
      isSharedFault: true,
      verdictDetail: detail,
    })
    .onConflictDoUpdate({
      target: diagnosticRuns.dedupeKey,
      set: {
        mergedCount: sql`${diagnosticRuns.mergedCount} + 1`,
        lastMergedAt: now,
        verdictDetail: detail,
      },
    })
    .returning({ id: diagnosticRuns.id, mergedCount: diagnosticRuns.mergedCount });
  if (row.mergedCount === 0) {
    await db.insert(diagnosticFindings).values({
      runId: row.id,
      layer: "hulu",
      metric: "pelanggan_terganggu",
      label: "Pelanggan dengan alert baru",
      value: String(affected),
      threshold: String(p.massThreshold),
      comparator: "≥",
      status: "fail",
      detail,
      sourceRef: `alerts · ${p.massWindowMinutes} menit terakhir`,
      sampledAt: now,
    });
  }
}

export type AutoOutcome = "disabled" | "held" | "unknown_customer" | "queued" | "merged";

// Pemicu otomatis untuk satu pelanggan. Urutan: kebijakan, penahan gangguan
// massal, lalu penggabungan per jendela (dedupe_key).
export async function requestAutoDiagnostic(input: {
  customerId: string;
  reason: string;
  sourceRef: string | null;
  // Waktu kejadian pemicu (mulai alert); kosong = sekarang.
  complaintAt?: Date;
}): Promise<AutoOutcome> {
  const p = await getDiagnosticPolicy();
  if (!reasonEnabled(input.reason, p)) return "disabled";

  const since = new Date(Date.now() - p.massWindowMinutes * 60_000);
  const [{ affected }] = await db
    .select({ affected: sql<number>`count(distinct ${alerts.customerId})::int` })
    .from(alerts)
    .where(and(isNotNull(alerts.customerId), gt(alerts.startedAt, since)));
  if (affected >= p.massThreshold) {
    await recordSharedFault(affected, p);
    return "held";
  }

  const c = await loadCustomer(input.customerId);
  if (!c) return "unknown_customer";
  const [row] = await db
    .insert(diagnosticRuns)
    .values({
      customerId: c.id,
      routerId: c.routerId,
      triggerMode: "auto",
      triggerReason: input.reason,
      triggerSourceRef: input.sourceRef,
      complaintAt: input.complaintAt ?? new Date(),
      dedupeKey: autoDedupeKey(c.id, Date.now(), p.dedupeMinutes),
      priority: AUTO_PRIORITY,
    })
    .onConflictDoUpdate({
      target: diagnosticRuns.dedupeKey,
      set: { mergedCount: sql`${diagnosticRuns.mergedCount} + 1`, lastMergedAt: new Date() },
    })
    .returning({ id: diagnosticRuns.id, mergedCount: diagnosticRuns.mergedCount });
  if (row.mergedCount > 0) return "merged";
  queue().enqueue({ runId: row.id, routerKey: c.routerId, priority: AUTO_PRIORITY });
  return "queued";
}

// Tiket keluhan pada alert milik pelanggan memicu diagnosa.
export async function requestAutoDiagnosticForTicket(alertId: string) {
  const [a] = await db
    .select({ customerId: alerts.customerId })
    .from(alerts)
    .where(eq(alerts.id, alertId))
    .limit(1);
  if (!a?.customerId) return "unknown_customer" as const;
  return requestAutoDiagnostic({ customerId: a.customerId, reason: "ticket", sourceRef: `alert:${alertId}` });
}

const POLL_MS = 15_000;

// Pekerjaan latar: membaca alert baru dan perubahan billing menjadi isolir.
// Kejadian sebelum server start tidak diputar ulang.
export async function startDiagnosticAutoTrigger() {
  if (g.nocDiagnosticTrigger) return;
  // Run yang tertinggal saat server mati tidak akan pernah selesai; tandai
  // gagal supaya tidak menyamar sebagai "sedang berjalan" (dan tidak
  // mengunci tombol manual pelanggan itu).
  await db
    .update(diagnosticRuns)
    .set({ status: "failed", finishedAt: new Date(), error: "Server dimulai ulang sebelum diagnosa selesai." })
    .where(inArray(diagnosticRuns.status, ["queued", "running"]));

  let alertCursor = new Date();
  let billingSeen: Map<string, string> | null = null;

  async function tick() {
    const p = await getDiagnosticPolicy();
    const fresh = await db
      .select({
        id: alerts.id,
        customerId: alerts.customerId,
        type: alerts.type,
        createdAt: alerts.createdAt,
        startedAt: alerts.startedAt,
      })
      .from(alerts)
      .where(
        and(
          isNotNull(alerts.customerId),
          gt(alerts.createdAt, alertCursor),
          inArray(alerts.type, ["offline", "optical", "queue"]),
        ),
      )
      .orderBy(alerts.createdAt)
      .limit(500);
    for (const a of fresh) {
      alertCursor = a.createdAt;
      const reason = alertTriggerReason(a.type);
      if (p.triggerAlert && reason && a.customerId) {
        await requestAutoDiagnostic({
          customerId: a.customerId,
          reason,
          sourceRef: `alert:${a.id}`,
          complaintAt: a.startedAt,
        });
      }
    }

    const rows = await db
      .select({ customerId: billingStatus.customerId, status: billingStatus.status, runId: billingStatus.runId })
      .from(billingStatus);
    if (billingSeen && p.triggerBilling) {
      for (const r of rows) {
        if (r.status === "isolir" && billingSeen.get(r.customerId) !== "isolir") {
          await requestAutoDiagnostic({
            customerId: r.customerId,
            reason: "billing_isolir",
            sourceRef: r.runId ? `billing_sync:${r.runId}` : null,
          });
        }
      }
    }
    billingSeen = new Map(rows.map((r) => [r.customerId, r.status]));
  }

  let busy = false;
  g.nocDiagnosticTrigger = setInterval(() => {
    if (busy) return;
    busy = true;
    tick()
      .catch((err) => console.error("Pemicu diagnosa otomatis gagal:", message(err)))
      .finally(() => {
        busy = false;
      });
  }, POLL_MS);
}

type RunRow = typeof diagnosticRuns.$inferSelect & {
  customerName: string | null;
  pppoeUsername: string | null;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toDto(r: RunRow): DiagnosticRunDto {
  return {
    id: r.id,
    customerId: r.customerId,
    customerName: r.customerName,
    pppoeUsername: r.pppoeUsername,
    triggerMode: r.triggerMode,
    triggeredBy: r.triggeredBy,
    triggerReason: r.triggerReason,
    triggerSourceRef: r.triggerSourceRef,
    mergedCount: r.mergedCount,
    lastMergedAt: iso(r.lastMergedAt),
    status: r.status,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
    verdictLayer: r.verdictLayer,
    verdictDetail: r.verdictDetail,
    isSharedFault: r.isSharedFault,
    complaintAt: iso(r.complaintAt),
    timeline: r.timeline,
  };
}

function selectRuns() {
  return db
    .select({
      run: diagnosticRuns,
      customerName: customers.name,
      pppoeUsername: customers.pppoeUsername,
    })
    .from(diagnosticRuns)
    .leftJoin(customers, eq(customers.id, diagnosticRuns.customerId));
}

export async function listDiagnosticRuns(q: { customerId?: string; limit: number }) {
  const rows = await selectRuns()
    .where(q.customerId ? eq(diagnosticRuns.customerId, q.customerId) : undefined)
    .orderBy(desc(diagnosticRuns.createdAt))
    .limit(q.limit);
  return rows.map((r) => toDto({ ...r.run, customerName: r.customerName, pppoeUsername: r.pppoeUsername }));
}

const layerIndex = new Map<string, number>(diagnosticLayers.map((l, i) => [l.id, i]));

export async function getDiagnosticRun(id: string): Promise<DiagnosticRunDto | null> {
  const [r] = await selectRuns().where(eq(diagnosticRuns.id, id)).limit(1);
  if (!r) return null;
  const findings = await db
    .select()
    .from(diagnosticFindings)
    .where(eq(diagnosticFindings.runId, id))
    .orderBy(diagnosticFindings.checkedAt);
  const firewallRules = await db
    .select({
      table: firewallRuleHits.table,
      chain: firewallRuleHits.chain,
      ruleIndex: firewallRuleHits.ruleIndex,
      action: firewallRuleHits.action,
      scope: firewallRuleHits.scope,
      summary: firewallRuleHits.summary,
      comment: firewallRuleHits.comment,
      disabled: firewallRuleHits.disabled,
      matchedPackets: firewallRuleHits.matchedPackets,
      isStale: firewallRuleHits.isStale,
    })
    .from(firewallRuleHits)
    .innerJoin(firewallSnapshots, eq(firewallSnapshots.id, firewallRuleHits.snapshotId))
    .where(eq(firewallSnapshots.runId, id))
    .orderBy(firewallRuleHits.table, firewallRuleHits.ruleIndex);
  return {
    ...toDto({ ...r.run, customerName: r.customerName, pppoeUsername: r.pppoeUsername }),
    firewallRules,
    findings: findings
      .map(
        (f): FindingDto => ({
          id: f.id,
          layer: f.layer as DiagnosticLayer,
          metric: f.metric,
          label: f.label,
          value: f.value,
          threshold: f.threshold,
          comparator: f.comparator,
          status: f.status,
          detail: f.detail,
          sourceRef: f.sourceRef,
          sampledAt: iso(f.sampledAt),
          checkedAt: f.checkedAt.toISOString(),
        }),
      )
      .sort((a, b) => (layerIndex.get(a.layer) ?? 99) - (layerIndex.get(b.layer) ?? 99)),
  };
}
