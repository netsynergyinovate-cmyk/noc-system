import "server-only";
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { ApiError } from "@/lib/api";
import { auditLog, customers, deviceTestResults, oltOnus, oltPonPorts, olts, routers } from "@/db/schema";
import { callerIdLookupAllowed, sessionNameForOnu } from "@/lib/dashboard/onu-caller-id";
import { codeContradictsPppoe, matchOnuToCustomer, onuNameCode } from "@/lib/dashboard/onu-matcher";
import { displayNameFromOnu } from "@/lib/dashboard/onu-name";
import { classifyOnuTrouble, summarizeOnuTroubles, type OnuTroubleEvaluation } from "@/lib/dashboard/onu-trouble-classifier";
import { env } from "@/lib/env";
import { MikrotikRestClient } from "@/lib/mikrotik/client";
import { getRouterDecryptedCredentials } from "@/services/device-credentials.service";
import { testMikrotikConnection } from "@/services/device-connection.service";
import {
  getMockPonPortDetail,
  getMockPonPorts,
  WEAK_RX_DBM,
  type PonOnuDetail,
  type PonPortDetail,
  type PonPortSummary,
} from "@/lib/dashboard/pon-ports";
import { decryptAES256GCM, encryptAES256GCM } from "@/lib/encryption";
import { HsgqClient, type HsgqOnu } from "@/lib/olt/hsgq-client";
import {
  oltIdSchema,
  ONU_DEFAULT_LIMIT,
  ONU_MAX_LIMIT,
  type CreateOltInput,
  type ListOnusParams,
  type LiveOnuFilterInput,
} from "@/validators/devices";

// Kolom publik saja: `passwordEnc` tidak boleh keluar dari server. Dipilih di
// SQL supaya tidak ada pemanggil yang lupa menyaringnya.
const publicRouterColumns = {
  id: routers.id,
  name: routers.name,
  host: routers.host,
  username: routers.username,
  status: routers.status,
  lastSeenAt: routers.lastSeenAt,
  createdAt: routers.createdAt,
};

const publicOltColumns = {
  id: olts.id,
  name: olts.name,
  host: olts.host,
  brand: olts.brand,
  driver: olts.driver,
  username: olts.username,
  status: olts.status,
  lastSeenAt: olts.lastSeenAt,
  createdAt: olts.createdAt,
};

export type RouterItem = Awaited<ReturnType<typeof listRouters>>[number];
export type OltItem = Awaited<ReturnType<typeof createOlt>>;

function listRouters() {
  return db.select(publicRouterColumns).from(routers).orderBy(asc(routers.name));
}

export async function listDevices() {
  const [routerRows, oltRows, ponCounts, onuCounts] = await Promise.all([
    listRouters(),
    db.select(publicOltColumns).from(olts).orderBy(asc(olts.name)),
    // Jumlah port dan ONU dihitung dari hasil polling backend (olt_pon_ports, olt_onus),
    // bukan angka bawaan.
    db.select({ oltId: oltPonPorts.oltId, n: count() }).from(oltPonPorts).groupBy(oltPonPorts.oltId),
    db
      .select({
        oltId: oltOnus.oltId,
        total: count(),
        online: sql<number>`count(*) filter (where ${oltOnus.status} = 'online')`.mapWith(Number),
      })
      .from(oltOnus)
      .groupBy(oltOnus.oltId),
  ]);
  const ponByOlt = new Map(ponCounts.map((r) => [r.oltId, r.n]));
  const onuByOlt = new Map(onuCounts.map((r) => [r.oltId, r]));
  return {
    routers: routerRows,
    olts: oltRows.map((o) => ({
      ...o,
      ponPortCount: ponByOlt.get(o.id) ?? 0,
      onuTotal: onuByOlt.get(o.id)?.total ?? 0,
      onuOnline: onuByOlt.get(o.id)?.online ?? 0,
    })),
    total: routerRows.length + oltRows.length,
  };
}

// ---- Status perangkat + waktu pemeriksaan ----
export type Reachability = "reachable" | "unreachable" | "unknown";
export const REACHABLE_WINDOW_MS = 5 * 60 * 1000;

export type DeviceStatusItem = {
  id: string;
  name: string;
  host: string;
  status: string;
  lastSeenAt: string | null;
  lastCheckedAt: string | null;
  lastTestStatus: string | null;
  reachability: Reachability;
  latencyMs: number | null;
};

type LatestTest = { host: string; status: string; latencyMs: number | null; testedAt: Date };
type DeviceRow = { id: string; name: string; host: string; status: string; lastSeenAt: Date | null };

export function computeReachability(
  d: Pick<DeviceRow, "status" | "lastSeenAt">,
  test: Pick<LatestTest, "status"> | null,
  now: number,
): Reachability {
  if (d.status === "nonaktif") return "unreachable";
  const seenRecently = d.lastSeenAt !== null && now - d.lastSeenAt.getTime() <= REACHABLE_WINDOW_MS;
  if (test?.status === "connected" || seenRecently) return "reachable";
  if (test && test.status !== "untested") return "unreachable"; // disconnected / error / timeout
  return "unknown";
}

function toStatusItem(d: DeviceRow, test: LatestTest | null, now: number): DeviceStatusItem {
  return {
    id: d.id,
    name: d.name,
    host: d.host,
    status: d.status,
    lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
    lastCheckedAt: test ? test.testedAt.toISOString() : null,
    lastTestStatus: test?.status ?? null,
    reachability: computeReachability(d, test, now),
    latencyMs: test?.latencyMs ?? null,
  };
}

/** Murni: gabungkan perangkat dengan hasil uji terbaru per host. */
export function buildDevicesStatus(
  routerRows: DeviceRow[],
  oltRows: DeviceRow[],
  routerTests: LatestTest[],
  oltTests: LatestTest[],
  nowDate = new Date(),
) {
  const now = nowDate.getTime();
  const byHost = (tests: LatestTest[]) => new Map(tests.map((t) => [t.host, t]));
  const rt = byHost(routerTests);
  const ot = byHost(oltTests);
  const routerItems = routerRows.map((r) => toStatusItem(r, rt.get(r.host) ?? null, now));
  const oltItems = oltRows.map((o) => toStatusItem(o, ot.get(o.host) ?? null, now));
  const n = (items: DeviceStatusItem[], r: Reachability) => items.filter((i) => i.reachability === r).length;
  const summary = {
    totalRouters: routerItems.length,
    onlineRouters: n(routerItems, "reachable"),
    offlineRouters: n(routerItems, "unreachable"),
    totalOlts: oltItems.length,
    onlineOlts: n(oltItems, "reachable"),
    offlineOlts: n(oltItems, "unreachable"),
    totalDevices: routerItems.length + oltItems.length,
    totalReachable: n(routerItems, "reachable") + n(oltItems, "reachable"),
    checkedAt: nowDate.toISOString(),
  };
  return { routers: routerItems, olts: oltItems, summary };
}

// Hasil uji terbaru per host untuk satu jenis perangkat.
function latestTests(deviceType: "mikrotik" | "olt"): Promise<LatestTest[]> {
  return db
    .selectDistinctOn([deviceTestResults.host], {
      host: deviceTestResults.host,
      status: deviceTestResults.status,
      latencyMs: deviceTestResults.latencyMs,
      testedAt: deviceTestResults.testedAt,
    })
    .from(deviceTestResults)
    .where(eq(deviceTestResults.deviceType, deviceType))
    .orderBy(asc(deviceTestResults.host), desc(deviceTestResults.testedAt));
}

export async function getDevicesStatusOverview() {
  const [routerRows, oltRows, routerTests, oltTests] = await Promise.all([
    listRouters(),
    db.select(publicOltColumns).from(olts).orderBy(asc(olts.name)),
    latestTests("mikrotik"),
    latestTests("olt"),
  ]);
  return buildDevicesStatus(routerRows, oltRows, routerTests, oltTests);
}

export async function listRoutersWithStatus() {
  return (await getDevicesStatusOverview()).routers;
}

export async function createOlt(input: CreateOltInput) {
  const [olt] = await db
    .insert(olts)
    .values({
      name: input.name,
      host: input.host,
      brand: input.brand,
      driver: input.driver,
      username: input.username,
      passwordEnc: encryptAES256GCM(input.password),
      status: "aktif",
    })
    .returning(publicOltColumns);
  return olt;
}

export async function getOlt(id: string) {
  const [olt] = await db.select(publicOltColumns).from(olts).where(eq(olts.id, id)).limit(1);
  return olt ?? null;
}

export async function updateOlt(id: string, input: Partial<CreateOltInput>) {
  const { password, ...rest } = input;
  const set = {
    ...rest,
    ...(password !== undefined && { passwordEnc: encryptAES256GCM(password) }),
  };
  if (Object.keys(set).length === 0) return getOlt(id);
  const [olt] = await db.update(olts).set(set).where(eq(olts.id, id)).returning(publicOltColumns);
  return olt ?? null;
}

// pon ports & onus ikut terhapus lewat ON DELETE CASCADE di database.
export async function deleteOlt(id: string) {
  const rows = await db.delete(olts).where(eq(olts.id, id)).returning({ id: olts.id });
  return rows.length > 0;
}

// Hanya untuk driver OLT di sisi server. JANGAN kembalikan hasilnya ke klien
// atau route handler; jangan dicatat di log.
export async function getOltCredentials(id: string) {
  const [row] = await db
    .select({ host: olts.host, username: olts.username, passwordEnc: olts.passwordEnc })
    .from(olts)
    .where(eq(olts.id, id))
    .limit(1);
  if (!row) return null;
  return {
    host: row.host,
    username: row.username,
    password: decryptAES256GCM(row.passwordEnc),
  };
}

export type RouterConnectionResult =
  | { ok: true; version?: string; cpuLoad?: number; uptime?: string; boardName?: string }
  | { ok: false; code: string; message: string };

/**
 * Uji koneksi nyata ke router tersimpan. Sukses -> `last_seen_at` diperbarui;
 * gagal -> hasil error terstruktur dan `last_seen_at` tidak disentuh.
 */
export async function testRouterConnection(id: string): Promise<RouterConnectionResult> {
  const row = await db.query.routers.findFirst({ where: eq(routers.id, id) });
  if (!row) return { ok: false, code: "NOT_FOUND", message: "Router tidak ditemukan." };
  if (!row.passwordEnc) {
    return { ok: false, code: "NO_CREDENTIALS", message: "Router belum punya kata sandi tersimpan." };
  }
  try {
    const password = decryptAES256GCM(row.passwordEnc);
    const result = await testMikrotikConnection({ host: row.host, username: row.username, password });
    if (!result.ok) return { ok: false, code: "CONNECTION_FAILED", message: "Router tidak menjawab." };
    await db.update(routers).set({ lastSeenAt: new Date() }).where(eq(routers.id, id));
    return { ...result, ok: true };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, code: e.code, message: e.message };
    return { ok: false, code: "CONNECTION_FAILED", message: "Gagal menghubungi router." };
  }
}

// Perangkat dianggap "terpasang dan terhubung" bila berstatus aktif dan pernah
// berhasil dihubungi (last_seen_at terisi oleh backend setelah tes koneksi atau
// polling yang berhasil). Perangkat yang baru dicatat tetapi belum pernah
// menjawab tidak dihitung.
export async function countConnectedDevices() {
  const [[router], [olt]] = await Promise.all([
    db
      .select({ total: count() })
      .from(routers)
      .where(and(eq(routers.status, "aktif"), isNotNull(routers.lastSeenAt))),
    db
      .select({ total: count() })
      .from(olts)
      .where(and(eq(olts.status, "aktif"), isNotNull(olts.lastSeenAt))),
  ]);
  return { routers: router.total, olts: olt.total };
}

export async function hasConnectedDevice() {
  const connected = await countConnectedDevices();
  return connected.routers + connected.olts > 0;
}

// Pasangkan ONU yang belum punya pelanggan di OLT ini dengan pelanggan yang
// belum punya ONU. Ambigu/tidak cocok dibiarkan apa adanya. Urutan bukti: aturan
// nama/serial (onu-matcher), lalu MAC ONU dengan caller-id sesi PPPoE di router
// (hanya model yang terukur aman, lihat onu-caller-id).
// skipOperatorUnmapped (pemicu latar belakang): ONU yang pernah dilepas petugas
// tidak dipetakan ulang otomatis.
export async function autoMatchOnus(
  oltId: string,
  userId?: string | null,
  opts: { skipOperatorUnmapped?: boolean; dryRun?: boolean } = {},
) {
  const [onus, free] = await Promise.all([
    db
      .select({
        id: oltOnus.id,
        description: oltOnus.description,
        serialNumber: oltOnus.serialNumber,
        rxPower: oltOnus.rxPower,
        status: oltOnus.status,
        model: oltOnus.model,
      })
      .from(oltOnus)
      .where(
        and(
          eq(oltOnus.oltId, oltId),
          isNull(oltOnus.customerId),
          opts.skipOperatorUnmapped
            ? sql`not exists (select 1 from ${auditLog} where ${auditLog.action} = 'onu-unmapped' and ${auditLog.target} = '/api/onus/' || ${oltOnus.id}::text)`
            : undefined,
        ),
      ),
    db
      .select({ id: customers.id, name: customers.name, pppoeUsername: customers.pppoeUsername })
      .from(customers)
      .leftJoin(oltOnus, eq(oltOnus.customerId, customers.id))
      .where(isNull(oltOnus.id)),
  ]);

  // Kode di awal nama ONU yang dipakai lebih dari satu ONU di OLT ini (seluruh ONU,
  // termasuk yang sudah dipetakan) tidak bisa membedakan pelanggan.
  const allNames = await db
    .select({ description: oltOnus.description })
    .from(oltOnus)
    .where(eq(oltOnus.oltId, oltId));
  const codeCount = new Map<string, number>();
  for (const { description } of allNames) {
    const code = onuNameCode(description);
    if (code) codeCount.set(code, (codeCount.get(code) ?? 0) + 1);
  }
  const duplicateCodes = new Set([...codeCount].filter(([, n]) => n > 1).map(([code]) => code));

  type Claim = { onuId: string; customerId: string; onuName: string | null; rxPower: number | null; status: string; by: string };
  const result = { matched: 0, ambiguous: 0, unmatched: 0, namesFilled: 0 };
  const claims: Claim[] = [];
  const unresolved: typeof onus = [];
  for (const onu of onus) {
    const m = matchOnuToCustomer(onu, free, { duplicateCodes });
    if (m.status === "ambiguous") result.ambiguous++;
    else if (m.status === "unmatched") unresolved.push(onu);
    else claims.push({ onuId: onu.id, customerId: m.customerId, onuName: onu.description, rxPower: onu.rxPower, status: onu.status, by: m.status });
  }

  // ONU tanpa nama yang bisa dicocokkan: cari lewat sesi PPPoE yang MAC-nya berdekatan.
  const viaSession = unresolved.filter((o) => o.status === "online" && callerIdLookupAllowed(o.model));
  const resolved = new Set<string>();
  const sessions = viaSession.length > 0 ? await loadPppSessions() : null;
  if (sessions) {
    const idsByUser = new Map<string, string[]>();
    for (const c of free) {
      const k = c.pppoeUsername.trim().toLowerCase();
      idsByUser.set(k, [...(idsByUser.get(k) ?? []), c.id]);
    }
    for (const onu of viaSession) {
      const user = sessionNameForOnu(onu.serialNumber, sessions);
      const ids = user ? idsByUser.get(user.trim().toLowerCase()) : undefined;
      if (ids?.length !== 1) continue;
      // ONU yang sudah dilabeli kode pelanggan lain dibiarkan: label dan sesi saling bertentangan.
      const owner = free.find((c) => c.id === ids[0]);
      if (!owner || codeContradictsPppoe(onu.description, owner.pppoeUsername)) continue;
      resolved.add(onu.id);
      claims.push({ onuId: onu.id, customerId: ids[0], onuName: onu.description, rxPower: onu.rxPower, status: onu.status, by: "caller_id" });
    }
  }
  result.unmatched = unresolved.filter((o) => !resolved.has(o.id)).length;

  // Satu pelanggan diklaim beberapa ONU (nama kembar, ONU lama yang pindah port): hanya bila
  // tepat satu yang online; selain itu tidak menebak.
  const byCustomer = new Map<string, Claim[]>();
  for (const c of claims) byCustomer.set(c.customerId, [...(byCustomer.get(c.customerId) ?? []), c]);
  const pairs: Claim[] = [];
  for (const group of byCustomer.values()) {
    const live = group.length === 1 ? group : group.filter((c) => c.status === "online");
    if (live.length === 1) {
      pairs.push(live[0]);
      result.ambiguous += group.length - 1;
    } else {
      result.ambiguous += group.length;
    }
  }
  result.matched = pairs.length;
  const pairSummary = pairs.map((p) => ({ onuId: p.onuId, customerId: p.customerId, onuName: p.onuName, by: p.by }));
  if (opts.dryRun) return { ...result, pairs: pairSummary };

  await db.transaction(async (tx) => {
    for (const p of pairs) {
      await tx.update(oltOnus).set({ customerId: p.customerId }).where(eq(oltOnus.id, p.onuId));
      // Redaman langsung terlihat di dasbor; polling OLT berikutnya menimpa dengan nilai terbaru.
      if (p.rxPower !== null) {
        await tx.update(customers).set({ opticalPower: p.rxPower, lastUpdatedAt: new Date() }).where(eq(customers.id, p.customerId));
      }
      // Pelanggan hasil impor router bernama sama dengan username PPPoE-nya (router
      // tidak menyimpan nama). Nama dari OLT menggantikannya, tetapi tidak pernah
      // menimpa nama yang sudah diisi orang.
      const real = displayNameFromOnu(p.onuName);
      if (real) {
        const updated = await tx
          .update(customers)
          .set({ name: real })
          .where(and(eq(customers.id, p.customerId), eq(customers.name, customers.pppoeUsername)))
          .returning({ id: customers.id });
        result.namesFilled += updated.length;
      }
    }
    if (userId || result.matched > 0) {
      await tx.insert(auditLog).values({
        userId: userId ?? null,
        action: "onu-auto-matched",
        target: `/api/olts/${oltId}`,
        detail: { ...result, pairs: pairSummary },
      });
    }
  });
  return { ...result, pairs: pairSummary };
}

// Sesi PPPoE aktif semua router aktif, atau null bila ada router yang tidak terbaca: ONU
// bisa saja ada di router itu, dan tanpa semua sesi satu-satunya kandidat bisa modem tetangga.
async function loadPppSessions() {
  const active = await db.select({ id: routers.id }).from(routers).where(eq(routers.status, "aktif"));
  const sessions: { name: string; callerId: string; address: string }[] = [];
  for (const { id } of active) {
    try {
      const creds = await getRouterDecryptedCredentials(id);
      if (!creds) throw new Error("kredensial router tidak ditemukan");
      const client = new MikrotikRestClient({
        host: creds.host,
        port: creds.port,
        username: creds.username,
        password: creds.password,
        useSsl: creds.useTls,
        routerId: id,
        mode: "real",
      });
      sessions.push(...(await client.getPppActive()));
    } catch (err) {
      console.error(`Baca sesi PPPoE router ${id} gagal, pencocokan lewat MAC dilewati:`, err);
      return null;
    }
  }
  return sessions;
}

const ONU_AUTOMATCH_INTERVAL_MS = 5 * 60_000;
// Di globalThis: modul dimuat ulang saat hot reload dev, variabel modul akan memulai timer kedua.
const onuAutoMatchState = globalThis as typeof globalThis & { nocOnuAutoMatch?: { timer: NodeJS.Timeout; busy: boolean } };

// Pelanggan yang modemnya tidak bisa terdaftar di GenieACS tetap punya redaman dari OLT
// (olt_onus, dibaca poller lewat telnet), asal ONU-nya terpetakan. Pemetaan jangan menunggu
// petugas menekan tombol: dijalankan berkala untuk semua OLT aktif.
export async function autoMatchAllOnus() {
  const active = await db.select({ id: olts.id }).from(olts).where(eq(olts.status, "aktif"));
  for (const { id } of active) {
    try {
      await autoMatchOnus(id, null, { skipOperatorUnmapped: true });
    } catch (err) {
      console.error(`Pencocokan ONU otomatis gagal untuk OLT ${id}:`, err);
    }
  }
}

export function startOnuAutoMatch() {
  if (onuAutoMatchState.nocOnuAutoMatch) return;
  const tick = async () => {
    const s = onuAutoMatchState.nocOnuAutoMatch;
    if (!s || s.busy || env.DASHBOARD_DATA === "demo") return; // demo: tidak mengubah pemetaan
    s.busy = true;
    try {
      await autoMatchAllOnus();
    } catch (err) {
      console.error("Pencocokan ONU otomatis gagal:", err);
    } finally {
      s.busy = false;
    }
  };
  const timer = setInterval(() => void tick(), ONU_AUTOMATCH_INTERVAL_MS);
  timer.unref();
  onuAutoMatchState.nocOnuAutoMatch = { timer, busy: false };
  setTimeout(() => void tick(), 30_000).unref(); // beri waktu poller mengisi olt_onus dulu
}

// ---- Daftar & pemetaan ONU ----
const onuColumns = {
  id: oltOnus.id,
  model: oltOnus.model,
  oltId: oltOnus.oltId,
  oltName: olts.name,
  ponIndex: oltOnus.ponIndex,
  onuIndex: oltOnus.onuIndex,
  description: oltOnus.description,
  serialNumber: oltOnus.serialNumber,
  customerId: oltOnus.customerId,
  customerName: customers.name,
  pppoeUsername: customers.pppoeUsername,
  rxPower: oltOnus.rxPower,
  txPower: oltOnus.txPower,
  attenuation: oltOnus.attenuation,
  status: oltOnus.status,
  capturedAt: oltOnus.capturedAt,
  isWeak: sql<boolean>`coalesce(${oltOnus.rxPower} < ${WEAK_RX_DBM}, false)`,
};
export type OnuItem = NonNullable<Awaited<ReturnType<typeof getOnu>>>;

export async function getOnu(id: string) {
  const row = await db
    .select(onuColumns)
    .from(oltOnus)
    .leftJoin(customers, eq(customers.id, oltOnus.customerId))
    .innerJoin(olts, eq(olts.id, oltOnus.oltId))
    .where(eq(oltOnus.id, id))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  if (!row) return null;
  const trouble = classifyOnuTrouble({ status: row.status, rxPowerDbm: row.rxPower });
  return { ...row, trouble, isTroubled: trouble.isTroubled };
}

export async function getCustomerOnu(customerId: string) {
  const row = await db
    .select(onuColumns)
    .from(oltOnus)
    .leftJoin(customers, eq(customers.id, oltOnus.customerId))
    .innerJoin(olts, eq(olts.id, oltOnus.oltId))
    .where(eq(oltOnus.customerId, customerId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  if (!row) return null;
  const trouble = classifyOnuTrouble({ status: row.status, rxPowerDbm: row.rxPower });
  return { ...row, trouble, isTroubled: trouble.isTroubled };
}

export async function listOnus(params: ListOnusParams = {} as ListOnusParams) {
  const limit = Math.min(ONU_MAX_LIMIT, Math.max(1, params.limit ?? ONU_DEFAULT_LIMIT));
  const offset = Math.max(0, params.offset ?? 0);
  const conds: SQL[] = [];
  if (params.oltId) conds.push(eq(oltOnus.oltId, params.oltId));
  if (params.customerId) conds.push(eq(oltOnus.customerId, params.customerId));
  if (params.isMapped !== undefined) {
    conds.push(params.isMapped ? isNotNull(oltOnus.customerId) : isNull(oltOnus.customerId));
  }
  if (params.status) conds.push(eq(oltOnus.status, params.status));
  if (params.isWeak !== undefined) {
    const weak = sql`coalesce(${oltOnus.rxPower} < ${WEAK_RX_DBM}, false)`;
    conds.push(params.isWeak ? weak : sql`not ${weak}`);
  }
  if (params.isTroubled !== undefined) {
    const troubled = or(
      sql`${oltOnus.status} = 'los'`, // ponports: kolom status bertipe online|offline, 'los' tetap dijaga bila DB menyimpannya
      eq(oltOnus.status, "offline"),
      sql`coalesce(${oltOnus.rxPower} < -25, false)`,
    )!;
    conds.push(params.isTroubled ? troubled : sql`not (${troubled})`);
  }
  const q = params.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    conds.push(
      or(
        ilike(customers.name, like),
        ilike(customers.pppoeUsername, like),
        ilike(oltOnus.serialNumber, like),
      )!,
    );
  }
  const where = conds.length ? and(...conds) : undefined;
  const [items, [{ total }]] = await Promise.all([
    db
      .select(onuColumns)
      .from(oltOnus)
      .leftJoin(customers, eq(customers.id, oltOnus.customerId))
      .innerJoin(olts, eq(olts.id, oltOnus.oltId))
      .where(where)
      .orderBy(asc(olts.name), asc(oltOnus.ponIndex), asc(oltOnus.onuIndex))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(oltOnus)
      .leftJoin(customers, eq(customers.id, oltOnus.customerId))
      .where(where),
  ]);
  return {
    items: items.map((item) => {
      const trouble = classifyOnuTrouble({ status: item.status, rxPowerDbm: item.rxPower });
      return { ...item, trouble, isTroubled: trouble.isTroubled };
    }),
    total,
  };
}

/** null = ONU tidak ada. Pelanggan sudah punya ONU lain -> ApiError 409. */
export async function mapOnuToCustomer(onuId: string, customerId: string | null, userId?: string | null) {
  const updated = await db.transaction(async (tx) => {
    const [onuRow] = await tx
      .select({ id: oltOnus.id, rxPower: oltOnus.rxPower, prevCustomerId: oltOnus.customerId })
      .from(oltOnus)
      .where(eq(oltOnus.id, onuId))
      .limit(1);
    if (!onuRow) return false;

    if (customerId) {
      const [c] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).limit(1);
      if (!c) throw new ApiError(404, "CUSTOMER_NOT_FOUND", "Pelanggan tidak ditemukan.");
      const [taken] = await tx
        .select({ id: oltOnus.id })
        .from(oltOnus)
        .where(and(eq(oltOnus.customerId, customerId), ne(oltOnus.id, onuId)))
        .limit(1);
      if (taken) throw new ApiError(409, "CUSTOMER_ALREADY_MAPPED", "Pelanggan sudah dipetakan ke ONU lain.");
    }
    const rows = await tx
      .update(oltOnus)
      .set({ customerId })
      .where(eq(oltOnus.id, onuId))
      .returning({ id: oltOnus.id });
    if (rows.length === 0) return false;

    if (customerId) {
      await tx
        .update(customers)
        .set({ opticalPower: onuRow.rxPower, lastUpdatedAt: new Date() })
        .where(eq(customers.id, customerId));
    } else if (onuRow.prevCustomerId) {
      await tx
        .update(customers)
        .set({ opticalPower: null, lastUpdatedAt: new Date() })
        .where(eq(customers.id, onuRow.prevCustomerId));
    }

    await tx.insert(auditLog).values({
      userId: userId ?? null,
      action: customerId ? "onu-mapped" : "onu-unmapped",
      target: `/api/onus/${onuId}`,
      detail: { onuId, customerId },
    });
    return true;
  });
  return updated ? getOnu(onuId) : null;
}

// ---- Daftar port PON ----
/**
 * Ringkasan semua port PON satu OLT. null = OLT tidak ada / ID tidak dikenal.
 * Urutan sumber: mock (ID `olt-*` atau mode demo) -> tabel olt_pon_ports -> klien HSGQ langsung.
 */
export async function getOltPonPorts(oltId: string): Promise<PonPortSummary[] | null> {
  if (oltId.startsWith("olt-") && env.DASHBOARD_DATA === "live") return null; // jangan sajikan mock saat live
  if (oltId.startsWith("olt-") || env.DASHBOARD_DATA === "demo") {
    return getMockPonPorts(oltId, 8, oltId === "olt-1" ? "OLT Utama Kebon Jeruk" : "OLT Pasar Minggu");
  }
  if (!oltIdSchema.safeParse(oltId).success) return null;

  const olt = await getOlt(oltId);
  if (!olt) return null;

  const [rows, onuCounts] = await Promise.all([
    db.select().from(oltPonPorts).where(eq(oltPonPorts.oltId, oltId)).orderBy(asc(oltPonPorts.ponIndex)),
    db
      .select({ ponIndex: oltOnus.ponIndex, total: count() })
      .from(oltOnus)
      .where(eq(oltOnus.oltId, oltId))
      .groupBy(oltOnus.ponIndex),
  ]);
  const totals = new Map(onuCounts.map((r) => [r.ponIndex, r.total]));

  // ponports tabel tidak menyimpan status/kapasitas: status turunan dari data optik/ONU.
  // ponports tanpa pembacaan optik dilaporkan 0 dBm (PonPortSummary tidak mengizinkan null).
  if (rows.length > 0) {
    return rows.map((p) => {
      const onuCount = Math.max(totals.get(p.ponIndex) ?? 0, p.onuOnlineCount);
      return {
        id: `${oltId}-pon-${p.ponIndex}`,
        oltId,
        oltName: olt.name,
        ponIndex: p.ponIndex,
        name: `PON ${p.ponIndex}`,
        status: p.rxPower !== null || p.onuOnlineCount > 0 ? "up" : "down",
        capacity: 128,
        onuCount,
        onlineOnuCount: p.onuOnlineCount,
        txPowerDbm: p.txPower ?? 0,
        avgRxPowerDbm: p.rxPower ?? 0,
      };
    });
  }

  const creds = await getOltCredentials(oltId);
  if (!creds) return null;
  const client = new HsgqClient({
    ...creds,
    mode: env.DASHBOARD_DATA === "live" ? "real" : "simulator",
  });
  const ports = await client.getPonPorts();
  return ports.map((p) => ({
    id: `${oltId}-pon-${p.ponIndex}`,
    oltId,
    oltName: olt.name,
    ponIndex: p.ponIndex,
    name: p.name,
    status: p.status,
    capacity: p.capacity,
    onuCount: Math.max(totals.get(p.ponIndex) ?? 0, p.onuOnlineCount),
    onlineOnuCount: p.onuOnlineCount,
    txPowerDbm: p.txPowerDbm ?? 0,
    avgRxPowerDbm: p.rxPowerDbm ?? 0,
  }));
}

// ---- Status hidup/mati ONU langsung dari OLT ----
export type LiveOnuResult = {
  oltId: string;
  oltName: string;
  source: "live" | "simulator";
  syncedAt: number;
  summary: { total: number; online: number; offline: number; los: number };
  items: HsgqOnu[];
};

function buildLiveOnuResult(
  oltId: string,
  oltName: string,
  source: LiveOnuResult["source"],
  onus: HsgqOnu[],
  f: LiveOnuFilterInput,
): LiveOnuResult {
  const q = f.q?.toLowerCase();
  const items = onus.filter((o) => {
    if (f.status && o.status !== f.status) return false;
    if (q && !o.serialNumber.toLowerCase().includes(q) && !o.macAddress.toLowerCase().includes(q)) return false;
    if (f.isWeak) {
      const weak = o.rxPowerDbm !== null && o.rxPowerDbm < WEAK_RX_DBM;
      if (weak !== (f.isWeak === "true")) return false;
    }
    return true;
  });
  const summary = {
    total: items.length,
    online: items.filter((o) => o.status === "online").length,
    offline: items.filter((o) => o.status === "offline").length,
    los: items.filter((o) => o.status === "los").length,
  };
  return { oltId, oltName, source, syncedAt: Math.floor(Date.now() / 1000), summary, items };
}

/** null = ID tidak valid / OLT tidak ada. Mock (`olt-*`) dan mode demo memakai simulator. */
export async function getOltLiveOnus(oltId: string, filters: LiveOnuFilterInput): Promise<LiveOnuResult | null> {
  const mock = oltId.startsWith("olt-");
  if (mock && env.DASHBOARD_DATA === "live") return null; // jangan sajikan mock saat live
  if (!mock && !oltIdSchema.safeParse(oltId).success) return null;

  if (mock || env.DASHBOARD_DATA === "demo") {
    // Host simulator harus lolos sanitasi dan bukan berakhiran .0/.255 (itu memicu kegagalan simulasi).
    const client = new HsgqClient({ host: "10.0.0.1", username: "sim", password: "sim", mode: "simulator" });
    const onus = await client.getOnus(filters.ponIndex);
    const name = oltId === "olt-1" ? "OLT Utama Kebon Jeruk" : "OLT Pasar Minggu";
    return buildLiveOnuResult(oltId, name, "simulator", onus, filters);
  }

  const olt = await getOlt(oltId);
  if (!olt) return null;
  const creds = await getOltCredentials(oltId);
  if (!creds) return null;
  const live = env.DASHBOARD_DATA === "live";
  const client = new HsgqClient({ ...creds, mode: live ? "real" : "simulator" });
  const onus = await client.getOnus(filters.ponIndex);
  return buildLiveOnuResult(oltId, olt.name, live ? "live" : "simulator", onus, filters);
}

// ---- Redaman optik ONU dari OLT ----
export type OpticalCategory = "normal" | "warning" | "critical";
export type OltOpticalOnu = HsgqOnu & {
  lossDb: number | null;
  category: OpticalCategory;
  isWeak: boolean;
  trouble: OnuTroubleEvaluation;
  isTroubled: boolean;
};
export type OltOpticalData = {
  oltId: string;
  oltName: string;
  source: LiveOnuResult["source"];
  syncedAt: number;
  summary: {
    totalOnus: number;
    onlineOnus: number;
    normalCount: number;
    warningCount: number;
    criticalCount: number;
    avgRxDbm: number | null;
    minRxDbm: number | null;
    maxRxDbm: number | null;
  };
  items: OltOpticalOnu[];
};

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

function opticalCategory(o: HsgqOnu): OpticalCategory {
  const rx = o.rxPowerDbm;
  if (o.status !== "online" || rx === null) return "critical";
  if (rx < -30) return "critical";
  if (rx < WEAK_RX_DBM || rx > -8) return "warning"; // lemah atau overload
  return "normal";
}

/** null = ID tidak valid / OLT tidak ada. */
export async function getOltOpticalData(oltId: string, ponIndex?: number): Promise<OltOpticalData | null> {
  const result = await getOltLiveOnus(oltId, { ponIndex });
  if (!result) return null;
  const items: OltOpticalOnu[] = result.items.map((o) => {
    const trouble = classifyOnuTrouble({ status: o.status, rxPowerDbm: o.rxPowerDbm });
    return {
      ...o,
      lossDb: o.txPowerDbm !== null && o.rxPowerDbm !== null ? round(o.txPowerDbm - o.rxPowerDbm, 2) : null,
      category: opticalCategory(o),
      isWeak: o.rxPowerDbm !== null && o.rxPowerDbm < WEAK_RX_DBM,
      trouble,
      isTroubled: trouble.isTroubled,
    };
  });
  const rxs = items.filter((o) => o.status === "online" && o.rxPowerDbm !== null).map((o) => o.rxPowerDbm as number);
  const count = (c: OpticalCategory) => items.filter((o) => o.category === c).length;
  return {
    oltId: result.oltId,
    oltName: result.oltName,
    source: result.source,
    syncedAt: result.syncedAt,
    summary: {
      totalOnus: items.length,
      onlineOnus: items.filter((o) => o.status === "online").length,
      normalCount: count("normal"),
      warningCount: count("warning"),
      criticalCount: count("critical"),
      avgRxDbm: rxs.length ? round(rxs.reduce((a, b) => a + b, 0) / rxs.length, 1) : null,
      minRxDbm: rxs.length ? Math.min(...rxs) : null,
      maxRxDbm: rxs.length ? Math.max(...rxs) : null,
    },
    items,
  };
}

// ---- Data optik PON port ----
export type OltPonPortOnu = Omit<PonOnuDetail, "rxPowerDbm" | "txPowerDbm" | "ontModel" | "customerName" | "pppoeUsername" | "address" | "serialNumber" | "macAddress" | "distanceMeters"> & {
  // DB belum menyimpan MAC dan jarak; null sampai kolomnya ada.
  serialNumber: string | null;
  macAddress: string | null;
  distanceMeters: number | null;
  rxPowerDbm: number | null;
  txPowerDbm: number | null;
  ontModel: string | null;
  /** Kosong bila ONU belum dipetakan ke pelanggan. */
  customerName: string | null;
  pppoeUsername: string | null;
  address: string | null;
  trouble: OnuTroubleEvaluation;
  isTroubled: boolean;
};
export type OltPonPort = Omit<PonPortDetail, "txPowerDbm" | "rxPowerDbm" | "attenuationDb" | "onus"> & {
  txPowerDbm: number | null;
  rxPowerDbm: number | null;
  attenuationDb: number | null;
  onus: OltPonPortOnu[];
  troubleSummary: ReturnType<typeof summarizeOnuTroubles>;
  troubledOnuCount: number;
  weakOnuCount: number;
  losOnuCount: number;
  source: "db" | "mock";
};

const epoch = (d: Date) => Math.floor(d.getTime() / 1000);

/** null = OLT tidak ada (dan bukan mode demo). Pada mode live, tidak pernah menyajikan mock. */
export async function getOltPonPort(oltId: string, ponIndex: number): Promise<OltPonPort | null> {
  const olt = await getOlt(oltId);
  const live = env.DASHBOARD_DATA === "live";
  const demo = env.DASHBOARD_DATA === "demo" && !live;
  const mock = (name?: string, host?: string): OltPonPort => {
    const d = getMockPonPortDetail(`olt-1-pon-${ponIndex}`);
    const troubleSummary = d.troubleSummary ?? summarizeOnuTroubles(d.onus);
    return {
      ...d,
      id: `${oltId}:${ponIndex}`,
      ...(name !== undefined && host !== undefined && { oltName: name, oltHost: host }),
      onus: d.onus.map((o) => {
        const trouble = o.trouble ?? classifyOnuTrouble(o);
        return { ...o, trouble, isTroubled: trouble.isTroubled };
      }),
      troubleSummary,
      troubledOnuCount: troubleSummary.troubled,
      weakOnuCount: troubleSummary.warningCount,
      losOnuCount: troubleSummary.losCount,
      source: "mock",
    };
  };
  if (!olt) return demo ? mock() : null;

  const [[port], onuRows] = await Promise.all([
    db.select().from(oltPonPorts).where(and(eq(oltPonPorts.oltId, oltId), eq(oltPonPorts.ponIndex, ponIndex))).limit(1),
    db
      .select({
        onuIndex: oltOnus.onuIndex,
        status: oltOnus.status,
        serialNumber: oltOnus.serialNumber,
        rx: oltOnus.rxPower,
        tx: oltOnus.txPower,
        capturedAt: oltOnus.capturedAt,
        customerName: customers.name,
        pppoeUsername: customers.pppoeUsername,
        address: customers.address,
      })
      .from(oltOnus)
      .leftJoin(customers, eq(customers.id, oltOnus.customerId))
      .where(and(eq(oltOnus.oltId, oltId), eq(oltOnus.ponIndex, ponIndex)))
      .orderBy(asc(oltOnus.onuIndex)),
  ]);
  if (!port && onuRows.length === 0) return demo ? mock(olt.name, olt.host) : null;

  const onus: OltPonPortOnu[] = onuRows.map((o) => {
    const trouble = classifyOnuTrouble({ status: o.status, rxPowerDbm: o.rx, distanceMeters: null });
    return {
    onuIndex: o.onuIndex,
    customerName: o.customerName,
    pppoeUsername: o.pppoeUsername,
    address: o.address,
    ontModel: null,
    serialNumber: o.serialNumber,
    macAddress: null,
    distanceMeters: null,
    rxPowerDbm: o.rx,
    txPowerDbm: o.tx,
    status: o.status,
    isWeak: o.rx !== null && o.rx < WEAK_RX_DBM,
    lastSeenAt: epoch(o.capturedAt),
    trouble,
    isTroubled: trouble.isTroubled,
    };
  });
  const troubleSummary = summarizeOnuTroubles(
    onus.map((o) => ({ status: o.status, rxPowerDbm: o.rxPowerDbm, distanceMeters: o.distanceMeters })),
  );
  return {
    id: `${oltId}:${ponIndex}`,
    oltName: olt.name,
    oltHost: olt.host,
    ponIndex,
    name: `PON 1/1/${ponIndex}`,
    capacity: 128,
    status: "up",
    txPowerDbm: port?.txPower ?? null,
    rxPowerDbm: port?.rxPower ?? null,
    attenuationDb: port?.attenuation ?? null,
    totalOnu: onus.length,
    onlineOnu: port?.onuOnlineCount ?? onus.filter((o) => o.status === "online").length,
    syncedAt: epoch(port?.capturedAt ?? onuRows[0].capturedAt),
    onus,
    troubleSummary,
    troubledOnuCount: troubleSummary.troubled,
    weakOnuCount: troubleSummary.warningCount,
    losOnuCount: troubleSummary.losCount,
    source: "db",
  };
}

