import "server-only";
import { ApiError } from "@/lib/api";
import {
  and,
  desc,
  eq,
  gt,
  gte,
  lte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import { NETFLOW_FRESH_MS } from "@/lib/dashboard/netflow-status";
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
  customerTrafficSamples,
  netflowSamples,
  trafficSamples,
} from "@/db/schema";
import {
  AUTO_PRIORITY,
  DNS_PROBE_NAME,
  autoDedupeKey,
  LOG_LOOKBACK_MS,
  MANUAL_PRIORITY,
  addressListMembership,
  alertTriggerReason,
  analyzeLog,
  auditRules,
  evaluateBgp,
  evaluateCustomerPing,
  evaluateDefaultRoute,
  evaluateDns,
  evaluateFlows,
  evaluateIpv6,
  evaluatePing,
  evaluateRateBaseline,
  evaluateTraceroute,
  evaluateTrafficTrend,
  evaluateUplinkHistory,
  evaluateUplinkRate,
  rosDurationMs,
  rosRateBps,
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
  decideVerdict,
  sharedDedupeKey,
  unchecked,
  compareRuns,
  runSummaryText,
  type PlanLimits,
  type RunComparison,
  type DiagnosticLayer,
  type PreviousVerdict,
  type ScopeEvidence,
  type Verdict,
  type VerdictRoot,
  type VerdictScope,
  type VerdictSecondary,
  type DiagnosticPolicyDto,
  type DiagnosticRunDto,
  type DnsProbe,
  type Finding,
  type FindingDto,
  type FirewallTable,
  type LogLine,
  type PingStats,
  type RateBaselineInput,
  type Ros,
  type RuleHit,
  type TimelineEvent,
  type TraceHop,
  type UplinkHistory,
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

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

async function loadCustomer(
  customerId: string,
): Promise<CustomerTarget | null> {
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
  reads.find((r): r is { ok: false; error: string } => !!r && !r.ok)?.error ??
  null;

const FIREWALL_TABLES: FirewallTable[] = ["filter", "raw", "nat", "mangle"];
// Ping dari router: 10 paket berjarak 0,2 dtk (±2 dtk per tujuan).
const PING_COUNT = 10;
// shortcut: satu tujuan internet tetap; jadikan pengaturan bila ISP memblokirnya.
const INTERNET_PROBE = "8.8.8.8";

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
  reads: Record<string, Read>;
  // Waktu (ms) tiap bacaan, untuk selang nyata antara dua sampel penghitung.
  at: Record<string, number>;
  // Antarmuka uplink dari default route aktif (Fase 5).
  uplinkName: string | null;
  membership: ReturnType<typeof addressListMembership> | null;
  // Buffer log memori router; dibaca hanya bila syslog tersimpan tidak mengalir.
  readLog: (() => Promise<Read>) | null;
  // Audit firewall (Fase 4); kosong bila IP/address-list/rule tidak terbaca.
  firewall: {
    hits: RuleHit[];
    fasttrack: boolean;
    outbound: Ros[];
    inbound: Ros[];
  } | null;
  client?: MikrotikRestClient | null;
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
    reads: {},
    at: {},
    uplinkName: null,
    membership: null,
    readLog: null,
    firewall: null,
  };
  if (c.routerStatus !== "aktif") {
    return {
      ...snapshot,
      error: `router berstatus "${c.routerStatus}", tidak dipoll`,
    };
  }
  const creds = await getRouterDecryptedCredentials(c.routerId);
  if (!creds)
    return { ...snapshot, error: "kredensial router tidak ditemukan" };
  const client = new MikrotikRestClient({
    host: creds.host,
    port: creds.port,
    username: creds.username,
    password: creds.password,
    useSsl: creds.useTls,
    routerId: c.routerId,
    mode: "real",
  });
  snapshot.client = client;
  const { reads } = snapshot;
  snapshot.readLog = () => attempt(() => client.read("/rest/log"));
  const read = async (
    key: string,
    path: string,
    filter?: Record<string, string>,
  ) => {
    snapshot.at[key] = Date.now();
    reads[key] = await attempt(() => client.read(path, filter));
  };
  const ping = async (key: string, address: string) => {
    reads[key] = await attempt(() =>
      client.measure("/rest/tool/ping", {
        address,
        count: String(PING_COUNT),
        interval: "0.2",
      }),
    );
  };

  await read("active", "/rest/ppp/active");
  if (!reads.active.ok) return { ...snapshot, error: reads.active.error };
  const wanted = c.pppoeUsername.toLowerCase().trim();
  const session =
    rows(reads.active).find(
      (s) => (s.name ?? "").toLowerCase().trim() === wanted,
    ) ?? null;
  await read("tracking", "/rest/ip/firewall/connection/tracking");
  const t1 = Date.now();

  // Hulu (Fase 5): dibaca juga saat pelanggan offline, karena gangguan hulu
  // justru sering membuat pelanggan putus.
  await read("route", "/rest/ip/route", { "dst-address": "0.0.0.0/0" });
  const route = rows(reads.route).find((r) => r.active === "true") ?? null;
  const [gatewayIp, uplinkName] = (route?.["immediate-gw"] ?? "").split("%");
  snapshot.uplinkName = uplinkName || null;
  if (uplinkName) {
    await read("uplink1", "/rest/interface", { name: uplinkName });
    if (firstRow(reads.uplink1)?.type === "ether") {
      reads.uplinkMonitor = await attempt(() =>
        client.measure("/rest/interface/ethernet/monitor", {
          numbers: uplinkName,
          once: "",
        }),
      );
    }
  }
  await read("bgpConn", "/rest/routing/bgp/connection");
  await read("bgpSess", "/rest/routing/bgp/session");
  await read("ipv6Addr", "/rest/ipv6/address");
  await read("ipv6Route", "/rest/ipv6/route", { "dst-address": "::/0" });
  await read("ipv6Bind", "/rest/ipv6/dhcp-server/binding");

  const iface = session ? `<pppoe-${session.name}>` : snapshot.iface;
  let vlanName: string | null = null;
  if (session) {
    snapshot.session = session;
    snapshot.iface = iface;
    await readCustomerPass1(session, iface);
    vlanName = firstRow(reads.binding)?.interface || null;
  }

  // Ping dari router mengisi jeda antar-sampel penghitung.
  if (gatewayIp) await ping("pingGateway", gatewayIp);
  await ping("pingInternet", INTERNET_PROBE);
  const wait = SAMPLE_GAP_MS - (Date.now() - t1);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  if (uplinkName)
    await read("uplink2", "/rest/interface", { name: uplinkName });
  if (session) {
    await read("queue2", "/rest/queue/simple", { name: iface });
    await read("ppp2", "/rest/interface", { name: iface });
    if (vlanName) await read("vlan2", "/rest/interface", { name: vlanName });
  }
  snapshot.readAt = new Date();
  return snapshot;

  async function readCustomerPass1(session: Ros, iface: string) {
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
      await read("lease", "/rest/ip/dhcp-server/lease", {
        address: session.address,
      });
      await read("addressList", "/rest/ip/firewall/address-list");
      const entries = rows(reads.addressList);
      if (reads.addressList.ok && entries.length <= MAX_ADDRESS_LIST) {
        snapshot.membership = addressListMembership(session.address, entries);
      }
      // Konfigurasi firewall dan koneksi pelanggan (proplist: hanya kolom yang dinilai).
      for (const table of FIREWALL_TABLES)
        await read(`fw_${table}`, `/rest/ip/firewall/${table}`);
      const props = { ".proplist": "fasttrack,connection-mark,protocol" };
      await read("connOut", "/rest/ip/firewall/connection", {
        "src-address": session.address,
        ...props,
      });
      await read("connIn", "/rest/ip/firewall/connection", {
        "dst-address": session.address,
        ...props,
      });
      if (
        snapshot.membership &&
        !failed(
          ...FIREWALL_TABLES.map((t) => reads[`fw_${t}`]),
          reads.connOut,
          reads.connIn,
        )
      ) {
        const hits = auditRules(
          Object.fromEntries(
            FIREWALL_TABLES.map((t) => [t, rows(reads[`fw_${t}`])]),
          ),
          { ip: session.address, iface, lists: snapshot.membership.lists },
        );
        const outbound = rows(reads.connOut);
        const inbound = rows(reads.connIn);
        snapshot.firewall = {
          hits,
          outbound,
          inbound,
          fasttrack:
            evaluateFasttrack(hits, [...outbound, ...inbound], "", new Date())
              .status === "fail",
        };
      }
    }
  }
}

// Selang nyata (detik) antara dua bacaan yang sama.
const gapOf = (s: RouterSnapshot, a: string, b: string) =>
  s.at[a] && s.at[b] ? (s.at[b] - s.at[a]) / 1000 : 0;

async function readMikrotik(
  c: CustomerTarget,
  ctx: RunContext,
): Promise<Finding[]> {
  const s = await ctx.router();
  const pppoe = evaluatePppoe({
    routerName: c.routerName,
    username: c.pppoeUsername,
    readAt: s.readAt,
    error: s.error,
    session: s.session
      ? {
          address: s.session.address ?? "",
          uptime: s.session.uptime ?? "",
          callerId: s.session["caller-id"] ?? "",
        }
      : null,
  });
  if (s.error || !s.session) {
    return [
      pppoe,
      unchecked(
        "mikrotik",
        "sesi_detail",
        "Queue, antarmuka, jalur PON, bentrok IP",
        s.error
          ? "Router tidak terbaca."
          : "Sesi PPPoE tidak aktif: queue dan antarmuka dinamis pelanggan tidak ada.",
        s.source,
      ),
    ];
  }
  const { reads, readAt: at } = s;
  const out: Finding[] = [pppoe];

  const qErr = failed(reads.queue1, reads.queue2);
  out.push(
    ...(qErr
      ? [
          unchecked(
            "mikrotik",
            "queue_limit",
            "Simple queue pelanggan",
            `Gagal membaca /queue/simple: ${qErr}`,
            s.source,
          ),
        ]
      : evaluateQueue(
          firstRow(reads.queue1),
          firstRow(reads.queue2),
          gapOf(s, "queue1", "queue2"),
          `${s.source} · /queue/simple ${s.iface}`,
          at,
        ).map(
          // PRD: fasttrack diperiksa sebelum menyimpulkan soal queue.
          (f): Finding =>
            s.firewall?.fasttrack && f.status === "ok"
              ? {
                  ...f,
                  status: "warn",
                  detail: `Fasttrack aktif: batas ini TIDAK dieksekusi untuk koneksi yang di-fasttrack. ${f.detail}`,
                }
              : f,
        )),
  );

  const pErr = failed(reads.ppp1, reads.ppp2);
  out.push(
    pErr
      ? unchecked(
          "mikrotik",
          "iface_errors",
          "Error & drop antarmuka PPPoE",
          `Gagal membaca /interface: ${pErr}`,
          s.source,
        )
      : evaluatePppInterface(
          firstRow(reads.ppp1),
          firstRow(reads.ppp2),
          gapOf(s, "ppp1", "ppp2"),
          `${s.source} · /interface ${s.iface}`,
          at,
        ),
  );

  const vlanName = firstRow(reads.binding)?.interface || null;
  const vErr = failed(reads.binding, reads.vlan1, reads.vlan2);
  out.push(
    vErr
      ? unchecked(
          "mikrotik",
          "pon_vlan_rate",
          "Laju jalur PON",
          `Gagal membaca antarmuka asal sesi: ${vErr}`,
          s.source,
        )
      : evaluatePonVlan(
          vlanName,
          firstRow(reads.vlan1),
          firstRow(reads.vlan2),
          gapOf(s, "vlan1", "vlan2"),
          `${s.source} · /interface ${vlanName ?? "—"}`,
          at,
        ),
  );

  const ip = s.session.address ?? "";
  const aErr = failed(reads.arp, reads.lease);
  out.push(
    !ip
      ? unchecked(
          "mikrotik",
          "ip_conflict",
          "Bentrok alamat (ARP/DHCP)",
          "Sesi tidak punya alamat IP.",
          s.source,
        )
      : aErr
        ? unchecked(
            "mikrotik",
            "ip_conflict",
            "Bentrok alamat (ARP/DHCP)",
            `Gagal membaca ARP/DHCP: ${aErr}`,
            s.source,
          )
        : evaluateIpConflict(
            ip,
            s.iface,
            rows(reads.arp),
            rows(reads.lease),
            `${s.source} · /ip/arp, /ip/dhcp-server/lease`,
            at,
          ),
  );
  return out;
}

async function readFirewall(
  c: CustomerTarget,
  ctx: RunContext,
): Promise<Finding[]> {
  const s = await ctx.router();
  if (s.error) {
    return [
      unchecked(
        "firewall",
        "ringkasan",
        "Firewall, NAT & connection tracking",
        `Router tidak terbaca: ${s.error}`,
        s.source,
      ),
    ];
  }
  const out: Finding[] = [];
  const ip = s.session?.address;
  if (!ip) {
    out.push(
      unchecked(
        "firewall",
        "address_list",
        "Address-list yang memuat IP pelanggan",
        "Sesi PPPoE tidak aktif: IP pelanggan tidak diketahui.",
        s.source,
      ),
    );
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
    out.push(
      evaluateAddressLists(
        ip,
        s.membership,
        `${s.source} · /ip/firewall/address-list`,
        s.readAt,
      ),
    );
  }
  const t = s.reads.tracking;
  out.push(
    t?.ok && t.value && typeof t.value === "object" && !Array.isArray(t.value)
      ? evaluateConntrack(
          t.value as Ros,
          `${s.source} · /ip/firewall/connection/tracking`,
          s.readAt,
        )
      : unchecked(
          "firewall",
          "conntrack",
          "Tabel connection tracking",
          `Gagal membaca connection tracking${failed(t) ? `: ${failed(t)}` : ""}.`,
          s.source,
        ),
  );
  out.push(...(await auditFirewall(c, ctx, s)));
  return out;
}

// Audit rule (Fase 4) dan simpan potretnya ke firewall_snapshots/_rule_hits.
async function auditFirewall(
  c: CustomerTarget,
  ctx: RunContext,
  s: RouterSnapshot,
): Promise<Finding[]> {
  const label = "Audit rule firewall & NAT";
  const ip = s.session?.address;
  if (!ip) {
    return [
      unchecked(
        "firewall",
        "audit",
        label,
        "Sesi PPPoE tidak aktif: IP pelanggan tidak diketahui, rule tidak bisa dicocokkan.",
        s.source,
      ),
    ];
  }
  if (!s.firewall) {
    const err = failed(
      ...FIREWALL_TABLES.map((t) => s.reads[`fw_${t}`]),
      s.reads.connOut,
      s.reads.connIn,
    );
    return [
      unchecked(
        "firewall",
        "audit",
        label,
        err
          ? `Gagal membaca firewall: ${err}`
          : "Address-list tidak terbaca utuh, keanggotaan pelanggan tidak diketahui.",
        s.source,
      ),
    ];
  }
  const { hits, outbound, inbound } = s.firewall;
  const ref = `${s.source} · /ip/firewall/{filter,raw,nat,mangle}`;
  const at = s.readAt;
  const t = s.reads.tracking;
  const tracking =
    t?.ok && t.value && typeof t.value === "object" && !Array.isArray(t.value)
      ? (t.value as Ros)
      : null;
  const connections = [...outbound, ...inbound];
  const findings = [
    evaluateFasttrack(hits, connections, `${ref}, /ip/firewall/connection`, at),
    evaluateFilterBlock(hits, ref, at),
    evaluateRaw(hits, ref, at),
    evaluateSrcNat(hits, ip, ref, at),
    evaluatePortForward(hits, rows(s.reads.fw_nat), ip, ref, at),
    evaluateMangle(
      hits,
      firstRow(s.reads.queue2) ?? firstRow(s.reads.queue1),
      connections,
      ref,
      at,
    ),
    evaluateCustomerConnections(
      outbound,
      inbound,
      tracking,
      `${s.source} · /ip/firewall/connection`,
      at,
    ),
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
      conntrackTotal: tracking
        ? Number(tracking["total-entries"]) || null
        : null,
      conntrackMax: tracking ? Number(tracking["max-entries"]) || null : null,
      rawDropMatched: hits.some(
        (h) =>
          h.table === "raw" &&
          !h.disabled &&
          ["drop", "reject"].includes(h.action),
      ),
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
  oltId: string;
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
      oltId: oltOnus.oltId,
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
      unchecked(
        "ont",
        "ont_found",
        "Modem di GenieACS",
        "GenieACS berjalan dalam mode simulator (bukan DASHBOARD_DATA=live): tidak ada data modem nyata.",
        "GenieACS",
      ),
    ];
  }
  const client = new GenieAcsClient(config);
  const wanted = c.pppoeUsername.toLowerCase().trim();
  // Cepat lewat query WANPPPConnection.1; cadangan: cocokkan semua WAN seperti halaman CPE.
  const deviceId =
    (await client.findDeviceIdByPppoe(c.pppoeUsername)) ??
    (await client.listDevices()).find(
      (d) => d.pppoeUsername.trim().toLowerCase() === wanted,
    )?.deviceId ??
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
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(
    new Date(),
  );

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
    return unchecked(
      "billing",
      "billing_mismatch",
      label,
      "Sinkron billing backend Go belum pernah berhasil, jadi billing_mismatches kosong. Kecocokan dicek lewat RunsNet ↔ router.",
      "billing_sync_runs",
    );
  }
  const found = await db
    .select({
      reason: billingMismatches.reason,
      invoiceName: billingMismatches.invoiceName,
    })
    .from(billingMismatches)
    .where(
      and(
        eq(billingMismatches.runId, run.id),
        sql`${billingMismatches.customerIds} @> array[${customerId}]::uuid[]`,
      ),
    );
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

async function readBilling(
  c: CustomerTarget,
  ctx: RunContext,
): Promise<Finding[]> {
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
    .select({
      status: billingStatus.status,
      syncedAt: billingStatus.syncedAt,
      billingName: billingStatus.billingName,
    })
    .from(billingStatus)
    .where(eq(billingStatus.customerId, c.id))
    .limit(1);

  const out: Finding[] = [
    rn ? evaluateRunsnetStatus(rn) : evaluateBilling(bs ?? null),
  ];
  if (rn) {
    const invoices = await db
      .select({
        dueDate: runsnetInvoices.dueDate,
        status: runsnetInvoices.status,
        remainingAmount: runsnetInvoices.remainingAmount,
      })
      .from(runsnetInvoices)
      .where(
        and(
          eq(runsnetInvoices.custId, custId),
          ne(runsnetInvoices.status, "paid"),
        ),
      );
    out.push(
      evaluateArrears(
        invoices,
        todayWib(),
        `RunsNet · tagihan ID ${custId}`,
        rn.syncedAt,
      ),
    );
  } else {
    out.push(
      unchecked(
        "billing",
        "arrears",
        "Tagihan lewat jatuh tempo",
        `ID ${custId} tidak ada di data RunsNet.`,
        "RunsNet",
      ),
    );
  }
  const s = await ctx.router();
  out.push(
    evaluateBillingNetwork({
      billingStatus:
        rn?.status ??
        (bs ? (bs.status === "isolir" ? "Isolir" : "Active") : null),
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
  new Intl.DateTimeFormat("id-ID", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Asia/Jakarta",
  }).format(d);
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
    ip:
      session?.address && session.address !== "0.0.0.0"
        ? session.address
        : null,
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
    const terms = [
      target.username,
      target.mac,
      target.ip,
      ...target.interfaces.map((i) => `${i} link`),
    ].filter((x): x is string => !!x);
    const lines = await db
      .select({
        at: syslogEvents.receivedAt,
        topics: syslogEvents.topics,
        message: syslogEvents.message,
      })
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
      coverageHint:
        "Syslog tersimpan masih baru; cakupannya bertambah seiring waktu sampai batas retensi.",
    });
  } else {
    const why = newest
      ? `syslog terakhir diterima ${fmtWib(newest)}`
      : "belum pernah ada syslog diterima";
    if (s.error || !s.readLog) {
      return [
        unchecked(
          "log",
          "log_coverage",
          "Cakupan log",
          `Syslog remote tidak mengalir ke NOC (${why}) dan router tidak terbaca${s.error ? `: ${s.error}` : ""}.`,
          s.source,
        ),
      ];
    }
    const mem = await s.readLog();
    if (!mem.ok) {
      return [
        unchecked(
          "log",
          "log_coverage",
          "Cakupan log",
          `Syslog remote tidak mengalir (${why}); buffer log router gagal dibaca: ${mem.error}`,
          s.source,
        ),
      ];
    }
    const lines = rows(mem)
      .map((e) => ({
        at: parseRouterLogTime(e.time ?? "", now),
        topics: e.topics ?? "",
        message: e.message ?? "",
      }))
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
async function alertTimeline(
  customerId: string,
  complaintAt: Date,
): Promise<TimelineEvent[]> {
  const list = await db
    .select({
      type: alerts.type,
      severity: alerts.severity,
      title: alerts.title,
      startedAt: alerts.startedAt,
      endedAt: alerts.endedAt,
    })
    .from(alerts)
    .where(
      and(
        eq(alerts.customerId, customerId),
        gte(
          alerts.startedAt,
          new Date(complaintAt.getTime() - LOG_LOOKBACK_MS),
        ),
      ),
    )
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
      ? [
          start,
          {
            ...start,
            at: a.endedAt.toISOString(),
            kind: "alert_end",
            label: `Alert ${what} selesai`,
          },
        ]
      : [start];
  });
}

// Satu langkah per lapisan, urut hulu ke hilir (sama dengan diagnosticLayers).
// Riwayat uplink (traffic_samples = counter antarmuka UPLINK per detik, rx =
// unduh) dan trafik pelanggan (customer_traffic_samples, bucket 5 menit) di
// sekitar waktu keluhan.
async function readUplinkHistory(
  c: CustomerTarget,
  complaintAt: Date,
): Promise<UplinkHistory> {
  const around = {
    from: new Date(complaintAt.getTime() - 15 * 60_000),
    to: new Date(complaintAt.getTime() + 15 * 60_000),
  };
  const dayFrom = new Date(complaintAt.getTime() - 24 * 3600_000);
  const rate = sql<number>`greatest(${trafficSamples.rxMbps}, ${trafficSamples.txMbps})`;
  const [near] = await db
    .select({
      peak: sql<number | null>`max(${rate})`,
      avg: sql<number | null>`avg(${rate})`,
      samples: sql<number>`count(*)::int`,
    })
    .from(trafficSamples)
    .where(
      and(
        eq(trafficSamples.routerId, c.routerId),
        gte(trafficSamples.sampledAt, around.from),
        lte(trafficSamples.sampledAt, around.to),
      ),
    );
  const [day] = await db
    .select({ avg: sql<number | null>`avg(${rate})` })
    .from(trafficSamples)
    .where(
      and(
        eq(trafficSamples.routerId, c.routerId),
        gte(trafficSamples.sampledAt, dayFrom),
        lte(trafficSamples.sampledAt, complaintAt),
      ),
    );
  const [cust] = await db
    .select({
      avg: sql<number | null>`avg(${customerTrafficSamples.downloadMbpsAvg})`,
    })
    .from(customerTrafficSamples)
    .where(
      and(
        eq(customerTrafficSamples.customerId, c.id),
        gte(
          customerTrafficSamples.bucketStart,
          new Date(complaintAt.getTime() - 10 * 60_000),
        ),
        lte(customerTrafficSamples.bucketStart, complaintAt),
      ),
    );
  // Rata-rata kebiasaan pelanggan: hanya bucket aktif (> 0,1 Mbps).
  const [custDay] = await db
    .select({
      avg: sql<number | null>`avg(${customerTrafficSamples.downloadMbpsAvg})`,
    })
    .from(customerTrafficSamples)
    .where(
      and(
        eq(customerTrafficSamples.customerId, c.id),
        gte(customerTrafficSamples.bucketStart, dayFrom),
        lte(customerTrafficSamples.bucketStart, around.from),
        gt(customerTrafficSamples.downloadMbpsAvg, 0.1),
      ),
    );
  const num = (v: number | string | null | undefined) =>
    v === null || v === undefined ? null : Number(v);
  return {
    peakMbps: num(near?.peak),
    avgMbps: num(near?.avg),
    dayAvgMbps: num(day?.avg),
    samples: near?.samples ?? 0,
    customerMbps: num(cust?.avg),
    customerDayMbps: num(custDay?.avg),
  };
}

export function parseQueueLimitsMbps(maxLimit: string | undefined): {
  limitUp: number | null;
  limitDown: number | null;
} {
  if (!maxLimit) return { limitUp: null, limitDown: null };
  const [upStr, downStr] = maxLimit.split("/");
  const parseOne = (s: string | undefined): number | null => {
    if (!s) return null;
    const str = s.trim();
    const num = Number(str);
    if (Number.isFinite(num)) return num > 0 ? num / 1e6 : null;
    const m = /^(\d+(?:\.\d+)?)\s*([KkMmGg])?bps?$/i.exec(str);
    if (!m) return null;
    const val = Number(m[1]);
    const unit = (m[2] ?? "").toUpperCase();
    if (unit === "G") return val * 1000;
    if (unit === "M") return val;
    if (unit === "K") return val / 1000;
    return val / 1e6;
  };
  return {
    limitUp: parseOne(upStr),
    limitDown: parseOne(downStr),
  };
}

// Fase 9: Satu sumber pembacaan batas paket pelanggan dari simple-queue router (max-limit).
// Dipakai bersama oleh readTraffic dan readActive. Bila router tidak terjangkau atau
// queue tidak ada, kembalikan batas null (jangan pernah mengarang paket).
export async function readCustomerPlanLimits(
  ctx: RunContext,
): Promise<PlanLimits> {
  const s = await ctx.router();
  const queueRow = firstRow(s.reads.queue1);
  const { limitUp, limitDown } = parseQueueLimitsMbps(queueRow?.["max-limit"]);
  return {
    downMbps: limitDown,
    upMbps: limitUp,
  };
}

// Lapisan trafik: tren dari customer_traffic_samples dan aliran dari
// netflow_samples di sekitar keluhan.
async function readTraffic(
  c: CustomerTarget,
  ctx: RunContext,
): Promise<Finding[]> {
  const t = ctx.complaintAt.getTime();
  const now = new Date();
  const from = new Date(t - 30 * 60_000);
  const to = new Date(Math.min(t + 30 * 60_000, now.getTime()));
  const [win] = await db
    .select({
      down: sql<number | null>`avg(${customerTrafficSamples.downloadMbpsAvg})`,
      up: sql<number | null>`avg(${customerTrafficSamples.uploadMbpsAvg})`,
      peak: sql<number | null>`max(${customerTrafficSamples.downloadMbpsMax})`,
      peakUp: sql<number | null>`max(${customerTrafficSamples.uploadMbpsMax})`,
      buckets: sql<number>`count(*)::int`,
    })
    .from(customerTrafficSamples)
    .where(
      and(
        eq(customerTrafficSamples.customerId, c.id),
        gte(customerTrafficSamples.bucketStart, from),
        lte(customerTrafficSamples.bucketStart, to),
      ),
    );
  // Jam keluhan di WIB (UTC+7 tetap, tanpa DST); baseline = jam yang sama ±1 jam (melingkar 0-23).
  const complaintHourWib = new Date(t + 7 * 3600_000).getUTCHours();
  const hourWib = sql`extract(hour from ${customerTrafficSamples.bucketStart} at time zone 'Asia/Jakarta')::int`;
  const [baseline] = await db
    .select({
      down: sql<number | null>`avg(${customerTrafficSamples.downloadMbpsAvg})`,
    })
    .from(customerTrafficSamples)
    .where(
      and(
        eq(customerTrafficSamples.customerId, c.id),
        gte(
          customerTrafficSamples.bucketStart,
          new Date(t - 7 * 24 * 3600_000),
        ),
        lte(customerTrafficSamples.bucketStart, from),
        gt(customerTrafficSamples.downloadMbpsAvg, 0.1),
        sql`least(abs(${hourWib} - ${complaintHourWib}::int), 24 - abs(${hourWib} - ${complaintHourWib}::int)) <= 1`,
      ),
    );
  const plan = await readCustomerPlanLimits(ctx);
  const num = (v: number | string | null | undefined) =>
    v === null || v === undefined ? null : Number(v);
  const out: Finding[] = [
    evaluateTrafficTrend(
      {
        windowDown: num(win?.down),
        windowUp: num(win?.up),
        windowPeakDown: num(win?.peak),
        windowPeakUp: num(win?.peakUp),
        buckets: win?.buckets ?? 0,
        baselineDown: num(baseline?.down),
        plan,
      },
      `customer_traffic_samples · ${c.pppoeUsername}`,
      now,
    ),
  ];

  // Hanya baris agregator (customer_id terisi) yang menandakan kolektor hidup. captured_at =
  // awal bucket 5 menit dan hanya bucket selesai yang di-flush tiap menit, jadi data terbaru
  // berumur ~5-11 menit; ambang NETFLOW_FRESH_MS (15 menit) memberi ruang untuk itu.
  const [stat] = await db
    .select({ newest: sql<string | null>`max(${netflowSamples.capturedAt})` })
    .from(netflowSamples)
    .where(
      and(
        eq(netflowSamples.routerId, c.routerId),
        isNotNull(netflowSamples.customerId),
      ),
    );
  const newest = stat?.newest ? new Date(stat.newest) : null;
  if (!newest || now.getTime() - newest.getTime() > NETFLOW_FRESH_MS) {
    out.push(
      unchecked(
        "trafik",
        "netflow_top",
        "Tujuan & protokol (NetFlow)",
        newest
          ? `NetFlow dari router ${c.routerName} berhenti mengalir (agregat terakhir ${fmtWib(newest)}).`
          : `NetFlow belum pernah diterima dari router ${c.routerName}: aktifkan traffic-flow router ke NOC (UDP 2055) dan kolektor NetFlow backend.`,
        "netflow_samples",
      ),
    );
    return out;
  }
  const flows = await db
    .select({
      direction: netflowSamples.direction,
      srcIp: netflowSamples.srcIp,
      dstIp: netflowSamples.dstIp,
      dstPort: netflowSamples.dstPort,
      protocol: netflowSamples.protocol,
      bytes: netflowSamples.bytes,
      flows: netflowSamples.flows,
    })
    .from(netflowSamples)
    .where(
      and(
        eq(netflowSamples.customerId, c.id),
        gte(netflowSamples.capturedAt, new Date(from.getTime() - 5 * 60_000)),
        lte(netflowSamples.capturedAt, to),
      ),
    );
  out.push(
    ...evaluateFlows(
      flows.map((f) => ({ ...f, direction: f.direction ?? "" })),
      `netflow_samples · ${c.routerName} · ${fmtWib(from)} – ${fmtWib(to)}`,
      now,
      {
        downMbps: plan.downMbps,
        upMbps: plan.upMbps,
        peakUpMbps: num(win?.peakUp),
      },
    ),
  );
  return out;
}
function parsePingStats(rawRows: unknown): PingStats | null {
  if (!Array.isArray(rawRows) || rawRows.length === 0) return null;
  const list = rawRows as Record<string, unknown>[];
  const last = list[list.length - 1];
  const lastSent = Number(last?.sent);
  const lastRecv = Number(last?.received);
  const rtts = list
    .map((r) => rosDurationMs(typeof r.time === "string" ? r.time : undefined))
    .filter((x): x is number => x !== null);
  const sent =
    Number.isFinite(lastSent) && lastSent > 0 ? lastSent : list.length;
  const received =
    Number.isFinite(lastRecv) && lastRecv >= 0 ? lastRecv : rtts.length;
  if (sent === 0) return null;
  const avgMs = rtts.length
    ? rtts.reduce((a, b) => a + b, 0) / rtts.length
    : null;
  const maxMs = rtts.length ? Math.max(...rtts) : null;
  const jitterMs =
    rtts.length > 1
      ? rtts.slice(1).reduce((s, x, i) => s + Math.abs(x - rtts[i]), 0) /
        (rtts.length - 1)
      : 0;
  return {
    sent,
    received,
    avgMs,
    maxMs,
    jitterMs,
  };
}

function parseTracerouteHops(rawRows: unknown): TraceHop[] {
  if (!Array.isArray(rawRows)) return [];
  const byHop = new Map<number, Record<string, unknown>>();
  for (const row of rawRows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    // RouterOS v7 memberi nomor hop lewat `.section` (mulai 0) atau urutan baris,
    // bukan field `hop`; `.id` berbentuk "*1A" dan tidak berguna sebagai nomor.
    const sectionNum = Number(r[".section"]);
    const hopNum = Number(
      r.hop ?? r.count ?? (Number.isFinite(sectionNum) ? sectionNum + 1 : NaN),
    );
    if (Number.isFinite(hopNum) && hopNum > 0) {
      byHop.set(hopNum, r);
    }
  }
  const hops: TraceHop[] = [];
  for (const [hop, r] of byHop.entries()) {
    const rawAddr = r.address ?? r.host ?? null;
    const addrStr = typeof rawAddr === "string" ? rawAddr.trim() : null;
    const address = !addrStr || addrStr === "*" ? null : addrStr;

    let lossPct = 0;
    if (r.loss !== undefined) {
      const parsed = parseFloat(String(r.loss).replace("%", ""));
      lossPct = Number.isFinite(parsed) ? parsed : 0;
    } else if (r["packet-loss"] !== undefined) {
      const parsed = parseFloat(String(r["packet-loss"]).replace("%", ""));
      lossPct = Number.isFinite(parsed) ? parsed : 0;
    } else if (r.sent !== undefined && r.received !== undefined) {
      const s = Number(r.sent);
      const rec = Number(r.received);
      if (s > 0) lossPct = Math.round(((s - rec) / s) * 100);
    } else if (address === null || r.status === "timeout") {
      lossPct = 100;
    }

    const timeRaw = r["avg-rtt"] ?? r.avg ?? r.time ?? r.rtt ?? r.last;
    // v7 memberi angka polos dalam milidetik ("12.3"); rosDurationMs butuh satuan.
    const avgMs =
      typeof timeRaw === "string"
        ? /^\d+(?:\.\d+)?$/.test(timeRaw)
          ? Number(timeRaw)
          : rosDurationMs(timeRaw)
        : typeof timeRaw === "number"
          ? timeRaw
          : null;

    hops.push({
      hop,
      address,
      lossPct,
      avgMs,
    });
  }
  hops.sort((a, b) => a.hop - b.hop);
  return hops;
}

function parseDnsResult(name: string, res: Read<unknown>): DnsProbe | null {
  if (!res.ok) {
    const err = res.error;
    const isDnsFailure =
      /dns|resolve|does not exist|nxdomain|host.*not.*found|cannot.*resolve|failure:\s*dns/i.test(
        err,
      );
    if (isDnsFailure) {
      return { name, resolved: false, ms: null, error: err };
    }
    return null;
  }
  if (!Array.isArray(res.value) || res.value.length === 0) {
    return null;
  }
  const rows = res.value as Record<string, unknown>[];
  for (const r of rows) {
    const st = String(r.status ?? "");
    if (
      /dns|resolve|does not exist|nxdomain|host.*not.*found|cannot.*resolve|failure:\s*dns/i.test(
        st,
      )
    ) {
      return { name, resolved: false, ms: null, error: st };
    }
  }
  const rtts = rows
    .map((r) => rosDurationMs(typeof r.time === "string" ? r.time : undefined))
    .filter((x): x is number => x !== null);
  const ms = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null;
  return { name, resolved: true, ms, error: null };
}

// Fase 7: Pengukuran aktif dari router (ping ke IP pelanggan, traceroute upstream,
// uji resolusi DNS) dan perbandingan trafik terhadap batas paket serta p95 mandiri 14 hari.
async function readActive(
  c: CustomerTarget,
  ctx: RunContext,
): Promise<Finding[]> {
  const s = await ctx.router();
  const now = new Date();
  const out: Finding[] = [];

  // (a) Ping ke pelanggan
  const session = s.session;
  const custIp = session?.address ?? null;
  if (!custIp) {
    out.push(evaluateCustomerPing(null, null, s.source, now));
  } else if (!s.client || s.error) {
    out.push(evaluateCustomerPing(custIp, null, s.source, now));
  } else {
    const pingRes = await attempt(() =>
      s.client!.measure("/rest/tool/ping", {
        address: custIp,
        count: String(PING_COUNT),
        interval: "0.2",
      }),
    );
    const stats = pingRes.ok ? parsePingStats(pingRes.value) : null;
    out.push(
      evaluateCustomerPing(
        custIp,
        stats,
        `${s.source} · /tool/ping ${custIp}`,
        now,
      ),
    );
  }

  // (b) Traceroute ke upstream (INTERNET_PROBE)
  if (!s.client || s.error) {
    out.push(evaluateTraceroute(INTERNET_PROBE, [], s.source, now));
  } else {
    const traceRes = await attempt(() =>
      s.client!.measure("/rest/tool/traceroute", {
        address: INTERNET_PROBE,
        count: "2",
      }),
    );
    const hops = traceRes.ok ? parseTracerouteHops(traceRes.value) : [];
    out.push(
      evaluateTraceroute(
        INTERNET_PROBE,
        hops,
        `${s.source} · /tool/traceroute ${INTERNET_PROBE}`,
        now,
      ),
    );
  }

  // (c) Resolusi DNS via ping hostname
  if (!s.client || s.error) {
    out.push(evaluateDns(null, s.source, now));
  } else {
    const dnsRes = await attempt(() =>
      s.client!.measure("/rest/tool/ping", {
        address: DNS_PROBE_NAME,
        count: "2",
      }),
    );
    const probe = parseDnsResult(DNS_PROBE_NAME, dnsRes);
    out.push(
      evaluateDns(probe, `${s.source} · /tool/ping ${DNS_PROBE_NAME}`, now),
    );
  }

  // (d) Baseline laju & batas paket per-pelanggan (14 hari mandiri)
  const t = ctx.complaintAt.getTime();
  const from = new Date(t - 30 * 60_000);
  const to = new Date(Math.min(t + 30 * 60_000, now.getTime()));
  const [win] = await db
    .select({
      down: sql<number | null>`avg(${customerTrafficSamples.downloadMbpsAvg})`,
      up: sql<number | null>`avg(${customerTrafficSamples.uploadMbpsAvg})`,
      peak: sql<number | null>`max(${customerTrafficSamples.downloadMbpsMax})`,
    })
    .from(customerTrafficSamples)
    .where(
      and(
        eq(customerTrafficSamples.customerId, c.id),
        gte(customerTrafficSamples.bucketStart, from),
        lte(customerTrafficSamples.bucketStart, to),
      ),
    );

  const [hist] = await db
    .select({
      p95Down: sql<
        number | null
      >`percentile_cont(0.95) within group (order by ${customerTrafficSamples.downloadMbpsMax}) filter (where ${customerTrafficSamples.downloadMbpsMax} > 0.1)`,
      p95Up: sql<
        number | null
      >`percentile_cont(0.95) within group (order by ${customerTrafficSamples.uploadMbpsMax}) filter (where ${customerTrafficSamples.uploadMbpsMax} > 0.1)`,
      buckets: sql<number>`count(*) filter (where ${customerTrafficSamples.downloadMbpsMax} > 0.1)::int`,
    })
    .from(customerTrafficSamples)
    .where(
      and(
        eq(customerTrafficSamples.customerId, c.id),
        gte(
          customerTrafficSamples.bucketStart,
          new Date(t - 14 * 24 * 3600_000),
        ),
        lte(customerTrafficSamples.bucketStart, from),
      ),
    );

  const plan = await readCustomerPlanLimits(ctx);
  const limitDown = plan.downMbps;
  const limitUp = plan.upMbps;
  const num = (v: number | string | null | undefined) =>
    v === null || v === undefined ? null : Number(v);

  const baselineInput: RateBaselineInput = {
    currentDown: num(win?.down),
    currentUp: num(win?.up),
    currentPeakDown: num(win?.peak),
    p95Down: num(hist?.p95Down),
    p95Up: num(hist?.p95Up),
    buckets: hist?.buckets ?? 0,
    limitDown,
    limitUp,
  };

  out.push(
    ...evaluateRateBaseline(
      baselineInput,
      `customer_traffic_samples · ${c.pppoeUsername}`,
      now,
    ),
  );

  return out;
}

// Lapisan hulu: default route & link, utilisasi uplink, ping dari router,
// riwayat uplink, BGP, IPv6. Masalah di sini adalah gangguan bersama.
async function readHulu(
  c: CustomerTarget,
  ctx: RunContext,
): Promise<Finding[]> {
  const s = await ctx.router();
  if (s.error) {
    return [
      unchecked(
        "hulu",
        "ringkasan",
        "Jalur hulu",
        `Router tidak terbaca: ${s.error}`,
        s.source,
      ),
    ];
  }
  const { reads } = s;
  const at = s.readAt;
  const mon = reads.uplinkMonitor?.ok ? reads.uplinkMonitor.value : null;
  const monitor = (Array.isArray(mon) ? mon[0] : mon) as Ros | null;
  const capacity = rosRateBps(monitor?.rate);
  const up = s.uplinkName ?? "uplink";
  const out: Finding[] = [];

  const routeErr = failed(reads.route);
  out.push(
    routeErr
      ? unchecked(
          "hulu",
          "default_route",
          "Default route & link uplink",
          `Gagal membaca /ip/route: ${routeErr}`,
          s.source,
        )
      : evaluateDefaultRoute(
          rows(reads.route),
          firstRow(reads.uplink1),
          monitor,
          `${s.source} · /ip/route, /interface ${up}`,
          at,
        ),
  );
  if (s.uplinkName) {
    const uErr = failed(reads.uplink1, reads.uplink2);
    out.push(
      uErr
        ? unchecked(
            "hulu",
            "uplink_util",
            `Utilisasi uplink ${up}`,
            `Gagal membaca /interface ${up}: ${uErr}`,
            s.source,
          )
        : evaluateUplinkRate(
            up,
            firstRow(reads.uplink1),
            firstRow(reads.uplink2),
            gapOf(s, "uplink1", "uplink2"),
            capacity,
            `${s.source} · /interface ${up}, ethernet/monitor`,
            at,
          ),
    );
  }
  for (const [key, kind] of [
    ["pingGateway", "gateway"],
    ["pingInternet", "internet"],
  ] as const) {
    const r = reads[key];
    if (!r) continue;
    const target =
      kind === "gateway"
        ? (firstRow(reads.route)?.["immediate-gw"] ?? "").split("%")[0]
        : INTERNET_PROBE;
    out.push(
      r.ok
        ? evaluatePing(
            kind,
            target,
            rows(r),
            `${s.source} · /tool/ping ${target}`,
            at,
          )
        : unchecked(
            "hulu",
            kind === "gateway" ? "upstream_gateway" : "upstream_internet",
            `Ping ke ${target}`,
            `Ping dari router gagal: ${r.error}`,
            s.source,
          ),
    );
  }
  out.push(
    ...evaluateUplinkHistory(
      await readUplinkHistory(c, ctx.complaintAt),
      capacity,
      `traffic_samples · ${c.routerName} (${up}) & customer_traffic_samples`,
      at,
    ),
  );
  const bErr = failed(reads.bgpConn, reads.bgpSess);
  out.push(
    bErr
      ? unchecked(
          "hulu",
          "bgp",
          "Peer BGP",
          `Gagal membaca /routing/bgp: ${bErr}`,
          s.source,
        )
      : evaluateBgp(
          rows(reads.bgpConn),
          rows(reads.bgpSess),
          `${s.source} · /routing/bgp/{connection,session}`,
          at,
        ),
  );
  const vErr = failed(reads.ipv6Addr, reads.ipv6Route);
  out.push(
    vErr
      ? unchecked(
          "hulu",
          "ipv6",
          "IPv6 pelanggan",
          `Gagal membaca /ipv6: ${vErr}`,
          s.source,
        )
      : evaluateIpv6(
          rows(reads.ipv6Addr),
          rows(reads.ipv6Route),
          rows(reads.ipv6Bind),
          s.session ? s.iface : null,
          `${s.source} · /ipv6/{address,route,dhcp-server/binding}`,
          at,
        ),
  );
  return out;
}

const steps: Record<
  DiagnosticLayer,
  (c: CustomerTarget, ctx: RunContext) => Promise<Finding[]>
> = {
  hulu: readHulu,
  mikrotik: readMikrotik,
  log: readLog,
  firewall: readFirewall,
  optik: async (_c, ctx) => [evaluateOptical(await ctx.onu(), new Date())],
  ont: readOnt,
  trafik: readTraffic,
  aktif: readActive,
  billing: readBilling,
};
async function loadScopeEvidence(
  c: CustomerTarget,
  onu: OnuRow | null,
  windowMinutes: number,
): Promise<ScopeEvidence> {
  const since = new Date(Date.now() - windowMinutes * 60_000);
  let routerEvidence: ScopeEvidence["router"] = null;
  let ponEvidence: ScopeEvidence["pon"] = null;

  if (c.routerId) {
    const [[servedRow], [affectedRow]] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(customers)
        .where(eq(customers.routerId, c.routerId)),
      db
        .select({
          count: sql<number>`count(distinct ${alerts.customerId})::int`,
        })
        .from(alerts)
        .innerJoin(customers, eq(customers.id, alerts.customerId))
        .where(
          and(
            eq(customers.routerId, c.routerId),
            ne(alerts.customerId, c.id),
            inArray(alerts.type, ["offline", "optical", "queue"]),
            // Gangguan yang masih berjalan tetap bukti walau mulai lebih lama dari
            // jendela; yang sudah selesai dihitung bila berakhir dalam jendela.
            or(
              and(isNull(alerts.endedAt), ne(alerts.status, "resolved")),
              gte(alerts.endedAt, since),
            ),
          ),
        ),
    ]);
    routerEvidence = {
      name: c.routerName,
      affected: affectedRow?.count ?? 0,
      served: servedRow?.count ?? 0,
    };
  }

  if (onu && onu.oltId && onu.ponIndex !== null && onu.ponIndex !== undefined) {
    const [[ponServedRow], [ponAffectedRow]] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(oltOnus)
        .where(
          and(eq(oltOnus.oltId, onu.oltId), eq(oltOnus.ponIndex, onu.ponIndex)),
        ),
      db
        .select({
          count: sql<number>`count(distinct ${alerts.customerId})::int`,
        })
        .from(alerts)
        .innerJoin(oltOnus, eq(oltOnus.customerId, alerts.customerId))
        .where(
          and(
            eq(oltOnus.oltId, onu.oltId),
            eq(oltOnus.ponIndex, onu.ponIndex),
            ne(alerts.customerId, c.id),
            inArray(alerts.type, ["offline", "optical", "queue"]),
            or(
              and(isNull(alerts.endedAt), ne(alerts.status, "resolved")),
              gte(alerts.endedAt, since),
            ),
          ),
        ),
    ]);
    ponEvidence = {
      name: `${onu.oltName} PON ${onu.ponIndex}`,
      affected: ponAffectedRow?.count ?? 0,
      served: ponServedRow?.count ?? 0,
    };
  }

  return {
    router: routerEvidence,
    pon: ponEvidence,
    windowMinutes,
  };
}

async function loadPreviousVerdict(
  customerId: string,
  excludeRunId: string,
): Promise<PreviousVerdict | null> {
  try {
    const [prev] = await db
      .select({
        verdictLayer: diagnosticRuns.verdictLayer,
        finishedAt: diagnosticRuns.finishedAt,
      })
      .from(diagnosticRuns)
      .where(
        and(
          eq(diagnosticRuns.customerId, customerId),
          ne(diagnosticRuns.id, excludeRunId),
          eq(diagnosticRuns.status, "done"),
          isNotNull(diagnosticRuns.finishedAt),
        ),
      )
      .orderBy(desc(diagnosticRuns.finishedAt))
      .limit(1);
    if (!prev || !prev.finishedAt) return null;
    return {
      layer: (prev.verdictLayer as DiagnosticLayer) ?? null,
      finishedAt: prev.finishedAt,
    };
  } catch (err) {
    console.warn(
      "[diagnostics] gagal memuat kesimpulan sebelumnya:",
      message(err),
    );
    return null;
  }
}

async function executeRun(runId: string) {
  const [run] = await db
    .update(diagnosticRuns)
    .set({ status: "running", startedAt: new Date() })
    .where(
      and(eq(diagnosticRuns.id, runId), eq(diagnosticRuns.status, "queued")),
    )
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
        found = [
          unchecked(
            layer.id,
            "galat",
            layer.label,
            `Gagal membaca lapisan: ${message(err)}`,
          ),
        ];
      }
      if (!found || found.length === 0) {
        found = [
          unchecked(
            layer.id,
            "kosong",
            layer.label,
            "Lapisan tidak menghasilkan temuan",
          ),
        ];
      }
      found = found.map((f) => ({
        ...f,
        detail:
          f.detail && f.detail.trim().length > 0
            ? f.detail
            : "alasan tidak dicatat",
      }));
      all.push(...found);
      await db
        .insert(diagnosticFindings)
        .values(found.map((f) => ({ ...f, runId })));
    }
    const policy = await getDiagnosticPolicy();
    const onu = await ctx.onu();
    let evidence: ScopeEvidence = {
      router: null,
      pon: null,
      windowMinutes: policy.massWindowMinutes,
    };
    try {
      evidence = await loadScopeEvidence(c, onu, policy.massWindowMinutes);
    } catch (err) {
      // shortcut: galat query bukti gangguan bersama tidak boleh menggagalkan diagnosa; fallback ke unknown
      console.warn("[diagnostics] gagal memuat bukti cakupan:", message(err));
      evidence = {
        router: null,
        pon: null,
        windowMinutes: policy.massWindowMinutes,
      };
    }
    const previous = await loadPreviousVerdict(c.id, runId);
    const now = new Date();
    const verdict = decideVerdict(all, evidence, previous, now);
    const root: VerdictRoot | null = verdict.root
      ? {
          ...verdict.root,
          name: verdict.root.kind === "customer" ? c.name : verdict.root.name,
        }
      : null;
    await db
      .update(diagnosticRuns)
      .set({
        status: "done",
        finishedAt: now,
        verdictLayer: verdict.layer,
        verdictDetail: verdict.detail,
        verdictScope: verdict.scope,
        verdictRoot: root,
        verdictSecondary: verdict.secondary,
        verdictHeld: verdict.held,
        isSharedFault: verdict.scope === "shared",
        timeline: [
          ...ctx.timeline,
          ...(await alertTimeline(c.id, complaintAt)),
        ].sort((a, b) => a.at.localeCompare(b.at)),
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
const queue = () =>
  (g.nocDiagnosticQueue ??= createDiagnosticQueue(executeRun));

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
      queue().enqueue({
        runId: created.id,
        routerKey: c.routerId,
        priority: MANUAL_PRIORITY,
      });
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
    if (running)
      return { run: (await getDiagnosticRun(running.id))!, reused: true };
  }
  throw new Error("Gagal memulai diagnosa manual.");
}

export async function getDiagnosticPolicy(): Promise<DiagnosticPolicyDto> {
  let [p] = await db
    .select()
    .from(diagnosticPolicy)
    .where(eq(diagnosticPolicy.id, 1));
  if (!p) {
    // Baris bawaan ditanam migrasi 0033; ini hanya bila baris itu terhapus.
    await db.insert(diagnosticPolicy).values({ id: 1 }).onConflictDoNothing();
    [p] = await db
      .select()
      .from(diagnosticPolicy)
      .where(eq(diagnosticPolicy.id, 1));
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
      verdictScope: "shared",
      verdictDetail: detail,
    })
    .onConflictDoUpdate({
      target: diagnosticRuns.dedupeKey,
      set: {
        mergedCount: sql`${diagnosticRuns.mergedCount} + 1`,
        lastMergedAt: now,
        verdictDetail: detail,
        verdictScope: "shared",
      },
    })
    .returning({
      id: diagnosticRuns.id,
      mergedCount: diagnosticRuns.mergedCount,
    });
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

export type AutoOutcome =
  "disabled" | "held" | "unknown_customer" | "queued" | "merged";

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
    .select({
      affected: sql<number>`count(distinct ${alerts.customerId})::int`,
    })
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
      set: {
        mergedCount: sql`${diagnosticRuns.mergedCount} + 1`,
        lastMergedAt: new Date(),
      },
    })
    .returning({
      id: diagnosticRuns.id,
      mergedCount: diagnosticRuns.mergedCount,
    });
  if (row.mergedCount > 0) return "merged";
  queue().enqueue({
    runId: row.id,
    routerKey: c.routerId,
    priority: AUTO_PRIORITY,
  });
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
  return requestAutoDiagnostic({
    customerId: a.customerId,
    reason: "ticket",
    sourceRef: `alert:${alertId}`,
  });
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
    .set({
      status: "failed",
      finishedAt: new Date(),
      error: "Server dimulai ulang sebelum diagnosa selesai.",
    })
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
      .select({
        customerId: billingStatus.customerId,
        status: billingStatus.status,
        runId: billingStatus.runId,
      })
      .from(billingStatus);
    if (billingSeen && p.triggerBilling) {
      for (const r of rows) {
        if (
          r.status === "isolir" &&
          billingSeen.get(r.customerId) !== "isolir"
        ) {
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
      .catch((err) =>
        console.error("Pemicu diagnosa otomatis gagal:", message(err)),
      )
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
    verdictScope: r.verdictScope ?? null,
    verdictRoot: r.verdictRoot ?? null,
    verdictSecondary: r.verdictSecondary ?? [],
    verdictHeld: r.verdictHeld ?? false,
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

export async function listDiagnosticRuns(q: {
  customerId?: string;
  limit: number;
}) {
  const rows = await selectRuns()
    .where(
      q.customerId ? eq(diagnosticRuns.customerId, q.customerId) : undefined,
    )
    .orderBy(desc(diagnosticRuns.createdAt))
    .limit(q.limit);
  return rows.map((r) =>
    toDto({
      ...r.run,
      customerName: r.customerName,
      pppoeUsername: r.pppoeUsername,
    }),
  );
}

const layerIndex = new Map<string, number>(
  diagnosticLayers.map((l, i) => [l.id, i]),
);

export async function getDiagnosticRun(
  id: string,
): Promise<DiagnosticRunDto | null> {
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
    .innerJoin(
      firewallSnapshots,
      eq(firewallSnapshots.id, firewallRuleHits.snapshotId),
    )
    .where(eq(firewallSnapshots.runId, id))
    .orderBy(firewallRuleHits.table, firewallRuleHits.ruleIndex);
  return {
    ...toDto({
      ...r.run,
      customerName: r.customerName,
      pppoeUsername: r.pppoeUsername,
    }),
    firewallRules,
    findings: findings
      .map((f): FindingDto => ({
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
      }))
      .sort(
        (a, b) =>
          (layerIndex.get(a.layer) ?? 99) - (layerIndex.get(b.layer) ?? 99),
      ),
  };
}

// Fase 9: Membandingkan dua run milik pelanggan yang sama.
// Mengembalikan null bila salah satu run tidak ditemukan; melempar ApiError 422 bila pelanggan berbeda.
export async function compareDiagnosticRuns(
  beforeId: string,
  afterId: string,
): Promise<RunComparison | null> {
  const [before, after] = await Promise.all([
    getDiagnosticRun(beforeId),
    getDiagnosticRun(afterId),
  ]);
  if (!before || !after) return null;
  if (before.customerId !== after.customerId) {
    throw new ApiError(
      422,
      "CUSTOMER_MISMATCH",
      "Hanya diagnosa dari pelanggan yang sama yang dapat dibandingkan.",
    );
  }
  return compareRuns(before, after);
}

// Fase 9: Melampirkan ringkasan diagnosa ke catatan tiket alert (alerts.ticket_notes).
// Idempoten: bila penanda runId sudah ada di catatan, tidak ditambahkan lagi.
// Alert harus milik pelanggan yang sama dengan run (selain itu melempar 422).
// Hanya kolom ticketNotes dan updatedAt yang diperbarui.
export async function attachDiagnosticToAlert(
  runId: string,
  alertId: string,
  userName: string,
): Promise<string> {
  const run = await getDiagnosticRun(runId);
  if (!run) {
    throw new ApiError(404, "NOT_FOUND", "Diagnosa tidak ditemukan.");
  }
  const [alert] = await db
    .select({
      id: alerts.id,
      customerId: alerts.customerId,
      ticketNotes: alerts.ticketNotes,
    })
    .from(alerts)
    .where(eq(alerts.id, alertId))
    .limit(1);

  if (!alert) {
    throw new ApiError(404, "NOT_FOUND", "Alert tidak ditemukan.");
  }

  if (
    !run.customerId ||
    !alert.customerId ||
    run.customerId !== alert.customerId
  ) {
    throw new ApiError(
      422,
      "CUSTOMER_MISMATCH",
      "Alert bukan milik pelanggan dari diagnosa ini.",
    );
  }

  const existingNotes = alert.ticketNotes ?? "";
  const marker = `[Diagnosa ${runId}`;
  if (existingNotes.includes(marker)) {
    return existingNotes;
  }

  const header = `[Diagnosa ${runId} · ${new Date().toISOString()} · ${userName}]`;
  const summary = runSummaryText(run);
  const snippet = `${header}\n${summary}`;
  const newNotes =
    existingNotes.trim().length > 0
      ? `${existingNotes.trim()}\n\n${snippet}`
      : snippet;

  await db
    .update(alerts)
    .set({
      ticketNotes: newNotes,
      updatedAt: new Date(),
    })
    .where(eq(alerts.id, alertId));

  return newNotes;
}
