import {
  anomalyRules,
  toAnomaly,
  toRawAnomaly,
  type Anomaly,
  type RawAnomaly,
} from "./anomalies.ts";
import { defaultSeverity } from "./incidents.ts";
import { correlateAlerts } from "./correlation.ts";
import {
  currentHandled,
  noHandled,
  type HandledMap,
  type HandledRecord,
} from "./handled-registry.ts";
import { groupImpact, mockDirectory } from "./incident-root.ts";
import { createMockCustomers, mockRouters } from "./mock-data.ts";
import { hashString, unit } from "./mock-random.ts";
import type { IncidentKind, IncidentSeverity } from "./types.ts";

// KONTRAK API ALERT AKTIF (yang diasumsikan frontend; backend belum
// mengimplementasikannya). Titik ganti ke backend: loadActiveAlerts di bawah ->
// GET /api/v1/alerts?status=active. Backend wajib mengisi tiga hal tentang
// waktu, karena petugas mencocokkan alert dengan keluhan pelanggan sampai ke
// menit dan detiknya:
//
//   startedAt              detik epoch BULAT: kapan gangguan mulai.
//   detectedAt             detik epoch BULAT: kapan sistem menetapkannya sebagai
//                          alert (startedAt + lama yang disyaratkan aturan).
//   timeSource             dari mana startedAt berasal, lihat AlertTimeSource.
//   timeUncertaintySeconds paling jauh berapa detik gangguan sebenarnya terjadi
//                          lebih awal dari startedAt.
//
// Detik epoch (bukan milidetik, bukan teks) supaya sama dengan event WebSocket.
//
// Backend juga wajib menyertakan di mana kejadiannya (location), supaya petugas
// tahu ke mana harus pergi atau menelepon tanpa membuka tabel lain, dan supaya
// peta bisa menyorotnya (lihat focusMap di store):
//
//   location.name       nama tempat yang dikenali petugas: ODP bila ada, kalau
//                       tidak alamat; untuk alert router, nama routernya. Selalu
//                       terisi.
//   location.address    alamat pelanggan, atau null.
//   location.odpName    nama ODP pelanggan (customers.odp_name), atau null.
//   location.latitude / longitude
//                       koordinat pelanggan (customers.latitude/longitude), atau
//                       KEDUANYA null. Alert router tidak punya koordinat karena
//                       router belum punya titik di database; jangan mengarang
//                       titik dari pelanggannya.
//
// RIWAYAT ALERT SELESAI. Titik ganti: loadResolvedAlerts di bawah ->
// GET /api/v1/alerts?status=resolved&from=&to= (baris network_logs yang ended_at
// terisi). Bentuknya sama dengan alert aktif, ditambah waktu selesai beserta
// ketelitiannya, karena petugas mencocokkan kapan internet pelanggan menyala lagi
// sampai ke detiknya:
//
//   endedAt                   detik epoch BULAT: kapan kondisinya berhenti.
//   endTimeSource             dari mana endedAt berasal (AlertTimeSource): "event"
//                             bila router sendiri mencatat pulihnya (script PPP
//                             on-up, syslog), "poll" bila backend baru melihatnya
//                             saat polling.
//   endTimeUncertaintySeconds paling jauh berapa detik pulihnya sebenarnya lebih
//                             awal dari endedAt.
//
// Sumber waktu selesai tidak harus sama dengan sumber waktu mulai: alert bisa
// mulai dari polling karena webhook on-down gagal, lalu selesai dari event on-up.
// Isian waktu di atas tidak berubah ketika alert pindah dari daftar aktif ke
// riwayat. Daftar aktif dan riwayat dimuat dalam satu pembaruan (loadAlertLists),
// dan batasnya tegas: aktif bila endedAt > now, riwayat bila endedAt <= now. Dengan
// begitu satu alert tidak tampil di dua daftar dan tidak hilang di antaranya.
// Urutan riwayat: yang paling akhir selesai di atas.
//
// DITANDAI DITANGANI. Petugas bisa menutup alert aktif lebih dulu dengan "Tandai
// ditangani" (alur PRD: alert lalu pindah ke riwayat). Titik ganti: handleAlert di
// alert-actions.ts -> POST /api/v1/alerts/{id}/handle (lihat backend/README.md).
// Alert yang ditandai muncul di riwayat sebagai ResolvedAlert biasa, dengan tiga
// isian yang artinya khusus:
//
//   endedAt        saat petugas mengonfirmasi (detik epoch BULAT, jam server),
//                  bukan saat jaringan terbukti pulih; ia selalu setelah
//                  detectedAt dan sebelum waktu selesai alami alert itu.
//   endTimeSource  "operator", dengan endTimeUncertaintySeconds 0.
//   handledBy      nama petugas dari sesi login; null untuk alert yang berhenti
//                  sendiri (endTimeSource "event" atau "poll").
//
// Isian lain tidak berubah. Alert yang sudah ditandai tidak pernah kembali ke
// daftar aktif, juga bila gangguannya masih berlangsung di jaringan.

export type AlertTimeSource =
  // Waktu dari kejadian di router itu sendiri (script PPP on-down lewat webhook,
  // atau baris syslog). Tepat sampai detik, mengikuti jam router.
  | "event"
  // Backend baru mengetahuinya saat polling, jadi kejadian sebenarnya bisa
  // lebih awal sampai satu selang polling.
  | "poll";

// Dari mana waktu SELESAI berasal: dua sumber di atas, atau petugas yang menandai
// alert ditangani sebelum jaringan pulih (atau sebelum backend melihatnya pulih).
export type AlertEndSource = AlertTimeSource | "operator";

export interface AlertLocation {
  name: string;
  address: string | null;
  odpName: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ActiveAlert extends Anomaly {
  endedAt: null;
  location: AlertLocation;
  detectedAt: number;
  timeSource: AlertTimeSource;
  timeUncertaintySeconds: number;
}

// Alert yang sudah berhenti: sama dengan ActiveAlert, tetapi endedAt terisi.
// Sumber akar dan dampak (IncidentImpact) tidak ikut, karena pengelompokan hanya
// dihitung untuk alert yang masih aktif dan riwayat belum membutuhkannya.
export interface ResolvedAlert extends RawAnomaly {
  endedAt: number;
  location: AlertLocation;
  detectedAt: number;
  timeSource: AlertTimeSource;
  timeUncertaintySeconds: number;
  // Ketelitian endedAt, terpisah dari ketelitian startedAt di atas.
  endTimeSource: AlertEndSource;
  endTimeUncertaintySeconds: number;
  // Petugas yang menandainya ditangani; null bila alert berhenti sendiri. Terisi
  // tepat bila endTimeSource === "operator".
  handledBy: string | null;
}

// Selang polling tiap jenis di backend (detik). Dipakai sebagai
// timeUncertaintySeconds bila waktunya berasal dari polling.
export const POLL_SECONDS: Record<IncidentKind, number> = {
  queue: 1,
  cpu: 5,
  port: 10,
  optical: 60,
  offline: 30,
};

const customersById = new Map(
  createMockCustomers().map((customer) => [customer.id, customer]),
);
const routersById = new Map(mockRouters.map((router) => [router.id, router]));

// Lokasi kejadian dari data yang sudah ada: titik dan alamat pelanggan untuk
// alert pelanggan, nama router untuk alert router.
export function locationFor(
  anomaly: Pick<Anomaly, "customerId" | "routerId">,
): AlertLocation {
  const customer = anomaly.customerId
    ? customersById.get(anomaly.customerId)
    : undefined;
  if (customer) {
    return {
      name: customer.odpName || customer.address || customer.name,
      address: customer.address || null,
      odpName: customer.odpName || null,
      latitude: customer.latitude,
      longitude: customer.longitude,
    };
  }
  return {
    name: routersById.get(anomaly.routerId)?.name ?? "Lokasi belum diketahui",
    address: null,
    odpName: null,
    latitude: null,
    longitude: null,
  };
}

const KINDS: IncidentKind[] = ["offline", "optical", "queue", "cpu", "port"];
const SLOT_SECONDS = 600;
const LOOKBACK_SLOTS = 9; // alert terlama yang masih mungkin aktif: 90 menit
const START_CHANCE = 0.6;
const EVENT_SHARE = 0.7; // sisa pelanggan offline baru ketahuan dari polling

// Satu alert tiruan per slot, paling banyak. Seluruh isinya ditentukan oleh nomor
// slot saja, tidak oleh `now`; `now` hanya menentukan daftar mana yang memuatnya:
// aktif selama detectedAt <= now < endedAt, riwayat sesudah endedAt. Karena itu
// alert yang aktif tadi muncul di riwayat dengan isian yang sama persis begitu
// waktunya lewat.
interface SlotAlert {
  id: string;
  kind: IncidentKind;
  startedAt: number;
  endedAt: number;
  detectedAt: number;
  timeSource: AlertTimeSource;
  timeUncertaintySeconds: number;
  endTimeSource: AlertTimeSource;
  endTimeUncertaintySeconds: number;
}

function alertInSlot(slot: number): SlotAlert | null {
  if (unit(slot * 11 + 3) > START_CHANCE) return null;
  const startedAt =
    slot * SLOT_SECONDS + Math.floor(unit(slot * 13 + 5) * SLOT_SECONDS);
  const kind = KINDS[Math.floor(unit(slot * 17 + 7) * KINDS.length)];
  const duration = 300 + Math.floor(unit(slot * 19 + 9) * 4500); // 5-80 menit
  const rule = anomalyRules.find((candidate) => candidate.kind === kind)!;
  const id = `alert-${slot}`;
  const fromEvent =
    kind === "offline" && unit(hashString(id) + 4) < EVENT_SHARE;
  // Pulihnya dicatat terpisah dari mulainya, jadi sumbernya bisa berbeda.
  const endFromEvent =
    kind === "offline" && unit(hashString(id) + 6) < EVENT_SHARE;
  return {
    id,
    kind,
    startedAt,
    endedAt: startedAt + duration,
    // Belum menjadi alert sebelum kondisinya bertahan selama aturannya.
    detectedAt: startedAt + rule.forSeconds,
    timeSource: fromEvent ? "event" : "poll",
    timeUncertaintySeconds: fromEvent ? 0 : POLL_SECONDS[kind],
    endTimeSource: endFromEvent ? "event" : "poll",
    endTimeUncertaintySeconds: endFromEvent ? 0 : POLL_SECONDS[kind],
  };
}

// Catatan "ditangani" yang berlaku untuk alert ini pada `now`, atau undefined.
// Berlaku bila petugas menandainya setelah alert terdeteksi dan sebelum selesai
// sendiri, dan saat itu sudah lewat pada `now`. Catatan di luar itu (jam yang
// bergeser, isi penyimpanan yang diubah tangan) diabaikan: alert aktif atau
// selesai seperti biasa. Satu aturan ini dipakai daftar aktif dan riwayat, jadi
// keduanya tidak pernah berbeda pendapat tentang satu alert.
function handledRecord(
  found: SlotAlert,
  handled: HandledMap,
  now: number,
): HandledRecord | undefined {
  const record = handled.get(found.id);
  if (!record || record.at > now) return undefined;
  if (record.at < found.detectedAt || record.at >= found.endedAt) {
    return undefined;
  }
  return record;
}

// DATA TIRUAN: fungsi dari waktu saja, jadi sama setiap dihitung. Sengaja
// dibuat lebih padat dari mockIncidents supaya selalu ada beberapa alert aktif
// untuk dilihat. `handled` (default: tidak ada) adalah alert yang sudah ditandai
// ditangani petugas; alert itu tidak lagi aktif.
export function mockActiveAlerts(
  now: number,
  handled: HandledMap = noHandled,
): ActiveAlert[] {
  const alerts: ActiveAlert[] = [];
  const lastSlot = Math.floor(now / SLOT_SECONDS);
  for (let slot = lastSlot - LOOKBACK_SLOTS; slot <= lastSlot; slot += 1) {
    const found = alertInSlot(slot);
    if (!found) continue;
    if (found.endedAt <= now) continue; // sudah selesai
    if (found.detectedAt > now) continue; // belum cukup lama untuk menjadi alert
    if (handledRecord(found, handled, now)) continue; // sudah ditandai ditangani

    const anomaly = toAnomaly({
      id: found.id,
      kind: found.kind,
      severity: defaultSeverity[found.kind],
      startedAt: found.startedAt,
      endedAt: null,
    });
    alerts.push({
      ...anomaly,
      endedAt: null,
      location: locationFor(anomaly),
      detectedAt: found.detectedAt,
      timeSource: found.timeSource,
      timeUncertaintySeconds: found.timeUncertaintySeconds,
    });
  }
  return withCorrelation(sortActiveAlerts(alerts));
}

// Seberapa jauh ke belakang riwayat dimuat. Sama dengan jendela halaman
// Deteksi Anomali, supaya keduanya bicara tentang rentang waktu yang sama.
export const ALERT_HISTORY_SECONDS = 7 * 24 * 3600;

// Riwayat bisa ratusan alert, jadi ditampilkan per halaman sebanyak ini.
export const ALERT_HISTORY_PAGE_SIZE = 15;

// Yang paling akhir selesai di atas.
export function sortResolvedAlerts(alerts: ResolvedAlert[]) {
  return [...alerts].sort(
    (a, b) => b.endedAt - a.endedAt || a.id.localeCompare(b.id),
  );
}

// DATA TIRUAN, dari pembangkit yang sama dengan mockActiveAlerts: alert yang
// selesai dalam `windowSeconds` terakhir (endedAt di dalam (now - jendela, now]).
// Alert yang ditandai ditangani (`handled`) selesai pada saat penandaannya, bukan
// pada waktu selesai alaminya, dan tercatat sebagai ditangani oleh petugas itu.
export function mockResolvedAlerts(
  now: number,
  windowSeconds = ALERT_HISTORY_SECONDS,
  handled: HandledMap = noHandled,
): ResolvedAlert[] {
  const since = now - windowSeconds;
  const lastSlot = Math.floor(now / SLOT_SECONDS);
  // Alert yang mulai sampai LOOKBACK_SLOTS slot sebelum jendela masih bisa
  // selesai di dalam jendela.
  const firstSlot = Math.floor(since / SLOT_SECONDS) - LOOKBACK_SLOTS;
  const alerts: ResolvedAlert[] = [];
  for (let slot = firstSlot; slot <= lastSlot; slot += 1) {
    const found = alertInSlot(slot);
    if (!found) continue;
    const record = handledRecord(found, handled, now);
    const endedAt = record ? record.at : found.endedAt;
    if (endedAt > now || endedAt <= since) continue;
    const details = toRawAnomaly({
      id: found.id,
      kind: found.kind,
      severity: defaultSeverity[found.kind],
      startedAt: found.startedAt,
      endedAt,
    });
    alerts.push({
      ...details,
      endedAt,
      location: locationFor(details),
      detectedAt: found.detectedAt,
      timeSource: found.timeSource,
      timeUncertaintySeconds: found.timeUncertaintySeconds,
      endTimeSource: record ? "operator" : found.endTimeSource,
      endTimeUncertaintySeconds: record ? 0 : found.endTimeUncertaintySeconds,
      handledBy: record ? record.by : null,
    });
  }
  return sortResolvedAlerts(alerts);
}

// Melengkapi tiap alert dengan sumber akar dan jumlah terdampak dari kelompok
// korelasinya.
export function withCorrelation(alerts: ActiveAlert[]): ActiveAlert[] {
  const impactById = new Map<string, ReturnType<typeof groupImpact>>();
  for (const group of correlateAlerts(alerts, {
    routerName: mockDirectory.routerName,
  })) {
    const impact = groupImpact(group, mockDirectory);
    for (const alert of group.alerts) impactById.set(alert.id, impact);
  }
  return alerts.map((alert) => ({ ...alert, ...impactById.get(alert.id)! }));
}

const severityRank = { critical: 0, warning: 1, info: 2 } as const;

// Yang paling genting dan paling baru di atas.
export function sortActiveAlerts(alerts: ActiveAlert[]) {
  return [...alerts].sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      b.startedAt - a.startedAt ||
      a.id.localeCompare(b.id),
  );
}

// Warna dan ikon ringkasan menurut yang paling genting: tidak ada alert "ok",
// ada yang kritis "critical", selain itu "warning".
export type AlertTone = "ok" | "warning" | "critical";

export interface SeveritySummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
  tone: AlertTone;
}

// Berapa alert di tiap tingkat. Dipakai kartu daftar alert aktif dan lencana di
// dasbor, supaya keduanya selalu menyebut angka dan warna yang sama.
export function summarizeAlertSeverity(
  alerts: readonly { severity: IncidentSeverity }[],
): SeveritySummary {
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const alert of alerts) counts[alert.severity] += 1;
  return {
    total: alerts.length,
    ...counts,
    tone:
      alerts.length === 0 ? "ok" : counts.critical > 0 ? "critical" : "warning",
  };
}

// Titik ganti ke backend: GET /api/v1/alerts?status=active
// (alert yang sudah ditandai ditangani tidak ikut: backend menyaringnya).
// `handled` hanya untuk uji; bawaannya catatan server tiruan.
export async function loadActiveAlerts(
  nowSec = Math.floor(Date.now() / 1000),
  handled: HandledMap = currentHandled(),
): Promise<ActiveAlert[]> {
  return mockActiveAlerts(nowSec, handled);
}

// Titik ganti ke backend: GET /api/v1/alerts?status=resolved&from=&to=
// (termasuk yang ditandai ditangani, dengan endTimeSource "operator")
export async function loadResolvedAlerts(
  nowSec = Math.floor(Date.now() / 1000),
  windowSeconds = ALERT_HISTORY_SECONDS,
  handled: HandledMap = currentHandled(),
): Promise<ResolvedAlert[]> {
  return mockResolvedAlerts(nowSec, windowSeconds, handled);
}

export interface AlertLists {
  active: ActiveAlert[];
  resolved: ResolvedAlert[];
}

// Alert yang ternyata sudah ada di riwayat tidak lagi aktif. Perlu bila kedua
// daftar datang dari dua permintaan yang tidak seketika: alert yang selesai di
// antaranya muncul di keduanya, dan yang benar adalah yang sudah selesai.
export function reconcileAlertLists(
  active: ActiveAlert[],
  resolved: ResolvedAlert[],
): AlertLists {
  const ended = new Set(resolved.map((alert) => alert.id));
  return { active: active.filter((alert) => !ended.has(alert.id)), resolved };
}

// Kedua daftar dimuat dalam satu pembaruan pada `nowSec` yang sama, supaya satu
// alert yang baru selesai pindah dari aktif ke riwayat sekaligus: tidak tampil di
// keduanya dan tidak hilang di antaranya. Aktif dimuat DULU, lalu riwayat: dengan
// backend sungguhan (dua permintaan) alert yang selesai di antaranya muncul di
// keduanya dan dibuang dari yang aktif; urutan terbalik membuatnya hilang sesaat.
export async function loadAlertLists(
  nowSec = Math.floor(Date.now() / 1000),
  handled: HandledMap = currentHandled(),
): Promise<AlertLists> {
  const active = await loadActiveAlerts(nowSec, handled);
  const resolved = await loadResolvedAlerts(
    nowSec,
    ALERT_HISTORY_SECONDS,
    handled,
  );
  return reconcileAlertLists(active, resolved);
}

// --- Tampilan lokasi -----------------------------------------------------

// Lokasi untuk ditampilkan: baris utama (ODP atau nama router), baris kedua
// (alamat), dan apakah ada titik di peta.
export function describeLocation(location: AlertLocation) {
  const hasPoint = location.latitude !== null && location.longitude !== null;
  const secondary =
    location.address ??
    (hasPoint ? null : "Titik di peta belum ada (alert tingkat router)");
  return { primary: location.name, secondary, hasPoint };
}

// --- Tampilan waktu -------------------------------------------------------

const clockFormat = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const dayFormat = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
});

// "14.32.07", dengan tanggal di depannya bila bukan hari yang sama dengan `now`
// (menurut zona waktu browser).
export function formatAlertTime(seconds: number, now: number) {
  const at = new Date(seconds * 1000);
  const clock = clockFormat.format(at);
  const sameDay =
    dayFormat.format(at) === dayFormat.format(new Date(now * 1000)) &&
    Math.abs(now - seconds) < 7 * 24 * 3600;
  return sameDay ? clock : `${dayFormat.format(at)}, ${clock}`;
}

function formatSeconds(seconds: number) {
  return seconds < 60
    ? `${seconds} detik`
    : seconds % 60 === 0
      ? `${seconds / 60} menit`
      : `${Math.round(seconds / 60)} menit`;
}

// Kata penanda untuk alert yang ditutup petugas, juga dicari oleh pencarian riwayat.
export function describeHandled(by: string) {
  return `ditangani oleh ${by}`;
}

// Penanda sumber waktu: `short` untuk label kecil di samping jam, `long` untuk
// penjelasan lengkap (tooltip dan pembaca layar). `moment` memilih kata yang
// sesuai: waktu mulai (kejadian) atau waktu selesai (pulihnya). Waktu selesai
// bisa juga dari petugas ("operator"); namanya ikut di `handledBy`.
export function describeTimeSource(
  alert: {
    timeSource: AlertEndSource;
    timeUncertaintySeconds: number;
    handledBy?: string | null;
  },
  moment: "start" | "end" = "start",
) {
  if (alert.timeSource === "operator") {
    const by = alert.handledBy?.trim() || "petugas";
    return {
      short: describeHandled(by),
      long: `Petugas ${by} menandai alert ini sudah ditangani pada waktu ini, tepat sampai detik (jam server). Ini saat alert ditutup petugas, bukan saat jaringan terbukti pulih.`,
    };
  }
  const ending = moment === "end";
  if (alert.timeSource === "event") {
    return {
      short: "dari router",
      long: ending
        ? "Waktu dicatat router saat kondisinya pulih, tepat sampai detik (mengikuti jam router)."
        : "Waktu dicatat router saat kejadian, tepat sampai detik (mengikuti jam router).",
    };
  }
  const span = formatSeconds(alert.timeUncertaintySeconds);
  return {
    short: `polling ±${span}`,
    long: ending
      ? `Backend mengetahui pulihnya lewat polling; pulih sebenarnya bisa sampai ${span} lebih awal dari waktu ini.`
      : `Backend mengetahuinya lewat polling; kejadian sebenarnya bisa sampai ${span} lebih awal dari waktu ini.`,
  };
}
