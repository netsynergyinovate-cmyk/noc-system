import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  alerts,
  billingStatus,
  customers,
  diagnosticFindings,
  diagnosticPolicy,
  diagnosticRuns,
  oltOnus,
  olts,
  routers,
} from "@/db/schema";
import {
  AUTO_PRIORITY,
  MANUAL_PRIORITY,
  alertTriggerReason,
  autoDedupeKey,
  createDiagnosticQueue,
  diagnosticLayers,
  evaluateBilling,
  evaluateOptical,
  evaluatePppoe,
  pendingLayer,
  pickVerdict,
  sharedDedupeKey,
  unchecked,
  type DiagnosticLayer,
  type DiagnosticPolicyDto,
  type DiagnosticRunDto,
  type Finding,
  type FindingDto,
} from "@/lib/diagnostics";
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

// Baca /ppp/active langsung dari router pelanggan. Kegagalan baca menjadi
// "tidak dapat diperiksa", tidak pernah "offline".
async function readPppoe(c: CustomerTarget): Promise<Finding> {
  const readAt = new Date();
  const base = { routerName: c.routerName, username: c.pppoeUsername, readAt };
  if (c.routerStatus !== "aktif") {
    return evaluatePppoe({ ...base, session: null, error: `router berstatus "${c.routerStatus}", tidak dipoll` });
  }
  const creds = await getRouterDecryptedCredentials(c.routerId);
  if (!creds) return evaluatePppoe({ ...base, session: null, error: "kredensial router tidak ditemukan" });
  try {
    const client = new MikrotikRestClient({
      host: creds.host,
      port: creds.port,
      username: creds.username,
      password: creds.password,
      useSsl: creds.useTls,
      mode: "real",
    });
    const wanted = c.pppoeUsername.toLowerCase().trim();
    const sessions = await client.getPppActive();
    const s = sessions.find((x) => x.name.toLowerCase().trim() === wanted);
    return evaluatePppoe({
      ...base,
      readAt: new Date(),
      session: s ? { address: s.address, uptime: s.uptime, callerId: s.callerId } : null,
      error: null,
    });
  } catch (err) {
    return evaluatePppoe({ ...base, session: null, error: message(err) });
  }
}

async function readOptical(customerId: string): Promise<Finding> {
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
  return evaluateOptical(onu ?? null, new Date());
}

async function readBilling(customerId: string): Promise<Finding[]> {
  const [row] = await db
    .select({
      status: billingStatus.status,
      syncedAt: billingStatus.syncedAt,
      billingName: billingStatus.billingName,
    })
    .from(billingStatus)
    .where(eq(billingStatus.customerId, customerId))
    .limit(1);
  return [
    evaluateBilling(row ?? null),
    pendingLayer("billing", "Ketidaksesuaian data billing (billing_mismatches)"),
  ];
}

// Satu langkah per lapisan, urut hulu ke hilir (sama dengan diagnosticLayers).
const steps: Record<DiagnosticLayer, (c: CustomerTarget) => Promise<Finding[]>> = {
  hulu: async () => [pendingLayer("hulu", "Utilisasi uplink, kualitas jalur hulu, BGP, IPv6")],
  mikrotik: async (c) => [
    await readPppoe(c),
    pendingLayer("mikrotik", "Simple queue, utilisasi interface, DHCP/ARP, ringkasan firewall"),
  ],
  log: async () => [pendingLayer("log", "Log RouterOS: PPPoE gagal, link flap, bentrok DHCP/ARP")],
  firewall: async () => [
    pendingLayer("firewall", "Filter/raw, NAT, address-list, fasttrack, conntrack, mangle"),
  ],
  optik: async (c) => [await readOptical(c.id)],
  ont: async () => [
    pendingLayer("ont", "WAN/PPPoE ONT, uptime, host Wi-Fi, redaman sisi ONT (GenieACS)"),
  ],
  trafik: async () => [pendingLayer("trafik", "Tren trafik pelanggan dan aliran NetFlow")],
  billing: (c) => readBilling(c.id),
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
    for (const layer of diagnosticLayers) {
      let found: Finding[];
      try {
        found = await steps[layer.id](c);
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
      .select({ id: alerts.id, customerId: alerts.customerId, type: alerts.type, createdAt: alerts.createdAt })
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
        await requestAutoDiagnostic({ customerId: a.customerId, reason, sourceRef: `alert:${a.id}` });
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
  return {
    ...toDto({ ...r.run, customerName: r.customerName, pppoeUsername: r.pppoeUsername }),
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
