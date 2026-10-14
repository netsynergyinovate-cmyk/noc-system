import { formatInteger } from "./format.ts";
import { createMockCustomers, mockRouters } from "./mock-data.ts";
import { hashString, unit } from "./mock-random.ts";
import type { BillingStatus, DashboardCustomer } from "./types";

// KONTRAK API STATUS BILLING (yang diasumsikan frontend; backend belum
// mengimplementasikannya). Titik ganti ke backend: loadBilling di bawah ->
// GET /api/v1/billing (lihat backend/README.md). Backend menyinkronkan billing
// tiap jam: masuk ke sistem billing (cookiejar + token CSRF), membaca tabel
// tagihan, lalu mencocokkan tiap tagihan dengan pelanggan lewat nama koneksi
// PPPoE. Hasilnya ditulis ke billing_status dan customers.billing_status;
// halaman Billing hanya membaca hasil itu.
//
// ATURAN PENCOCOKAN. matchBilling di bawah adalah rumusan aturan ini, dan
// sinkron di backend wajib memakai aturan yang sama:
//
//   1. Nama PPPoE di billing sama persis dengan customers.pppoe_username:
//      cocok "exact".
//   2. Bila tidak ada yang persis, nama dirapikan dulu (spasi di ujung dibuang,
//      semua huruf kecil) lalu dibandingkan. Cocok dengan TEPAT SATU pelanggan:
//      cocok "normalized". Billing sering menulis huruf besar atau menyisakan
//      spasi, jadi ini bukan kesalahan data pelanggan.
//   3. Tagihan yang tidak bisa dipasangkan tidak dipaksakan. Ia dilaporkan
//      dengan alasannya: "unknown" (tidak ada pelanggan bernama itu),
//      "duplicate" (pelanggan itu sudah dipasangkan dengan tagihan lain; yang
//      dipakai satu tagihan saja, dan yang persis menang atas yang dirapikan),
//      atau "ambiguous" (setelah dirapikan cocok dengan lebih dari satu
//      pelanggan, jadi tidak ditebak).
//   4. Pelanggan tanpa tagihan ("none") tidak diubah statusnya oleh sinkron:
//      status yang tersimpan tetap berlaku sampai ada tagihan yang cocok.
//
// Semua waktu adalah detik epoch BULAT, seperti kontrak alert. Jadwal sinkron
// (BillingSyncState) memuat sinkron yang sedang berjalan, waktu sinkron
// berikutnya, dan 24 sinkron terakhir yang sudah selesai, terbaru di atas.

export const BILLING_SYNC_INTERVAL_SECONDS = 3_600;

// Berapa sinkron terakhir yang ditampilkan di riwayat.
export const BILLING_HISTORY_RUNS = 24;

export const billingStatusLabels: Record<BillingStatus, string> = {
  lunas: "Lunas",
  isolir: "Isolir",
};

export type BillingMatch = "exact" | "normalized" | "none";

export const billingMatchLabels: Record<BillingMatch, string> = {
  exact: "Cocok",
  normalized: "Cocok setelah dirapikan",
  none: "Belum ada tagihan",
};

export const billingMatchHints: Record<BillingMatch, string> = {
  exact: "Nama PPPoE di billing sama persis.",
  normalized:
    "Nama PPPoE di billing beda huruf besar atau kecil, atau ada spasi di ujungnya.",
  none: "Tidak ada tagihan dengan nama PPPoE ini, jadi status yang tersimpan belum diperbarui dari billing.",
};

export type UnmatchedReason = "unknown" | "duplicate" | "ambiguous";

export const unmatchedLabels: Record<UnmatchedReason, string> = {
  unknown: "Tidak ada pelanggan",
  duplicate: "Tagihan ganda",
  ambiguous: "Cocok dengan banyak pelanggan",
};

export const unmatchedHints: Record<UnmatchedReason, string> = {
  unknown: "Tidak ada pelanggan dengan nama PPPoE ini.",
  duplicate:
    "Pelanggan dengan nama PPPoE ini sudah dipasangkan dengan tagihan lain.",
  ambiguous:
    "Setelah dirapikan, nama ini cocok dengan lebih dari satu pelanggan, jadi tidak ditebak.",
};

// Satu tagihan seperti dibaca dari sistem billing, sebelum dicocokkan.
export interface BillingRecord {
  invoiceRef: string;
  // Nama koneksi PPPoE persis seperti tertulis di billing.
  pppoeUsername: string;
  status: BillingStatus;
}

// Satu baris per pelanggan: status tagihan yang berlaku dan bagaimana ia
// didapat. Mengikuti customers.billing_status dan billing_status.invoice_ref.
export interface BillingRow {
  customerId: string;
  name: string;
  pppoeUsername: string;
  routerId: string;
  routerName: string;
  // Dari tagihan bila ada yang cocok, kalau tidak yang tersimpan sebelumnya.
  status: BillingStatus;
  match: BillingMatch;
  invoiceRef: string | null;
  // Nama PPPoE persis seperti di billing; null bila match "none".
  billingName: string | null;
}

// Tagihan yang tidak bisa dipasangkan dengan pelanggan mana pun.
export interface BillingUnmatched {
  invoiceRef: string;
  pppoeUsername: string;
  status: BillingStatus;
  reason: UnmatchedReason;
}

export interface BillingSyncResult {
  // Tagihan yang terbaca dari billing; selalu matched + unmatched.
  invoices: number;
  matched: number;
  unmatched: number;
  // Pelanggan yang tidak mendapat tagihan pada sinkron itu.
  withoutInvoice: number;
}

export interface BillingSyncRun {
  id: string;
  startedAt: number;
  finishedAt: number;
  status: "success" | "failed";
  // Terisi tepat bila berhasil.
  result: BillingSyncResult | null;
  // Pesan untuk petugas, terisi tepat bila gagal.
  error: string | null;
}

export interface BillingSyncState {
  intervalSeconds: number;
  // Sinkron yang sedang berjalan (belum selesai), atau null.
  running: { startedAt: number } | null;
  // Kapan sinkron berikutnya mulai; selalu setelah waktu data ini dibuat.
  nextRunAt: number;
  // Yang sudah selesai, terbaru di atas.
  runs: BillingSyncRun[];
}

export interface BillingOverview {
  sync: BillingSyncState;
  // Satu per pelanggan, urut nama.
  rows: BillingRow[];
  // Urut kode tagihan.
  unmatched: BillingUnmatched[];
}

// --- Pencocokan ------------------------------------------------------------

// Nama PPPoE dirapikan sebelum dibandingkan (aturan 2 di atas).
export function normalizePppoe(name: string) {
  return name.trim().toLowerCase();
}

export type BillingCustomer = Pick<
  DashboardCustomer,
  "id" | "name" | "pppoeUsername" | "routerId" | "billingStatus"
>;

const compareText = (a: string, b: string) =>
  a.localeCompare(b, "id", { numeric: true });

export interface BillingMatchResult {
  rows: BillingRow[];
  unmatched: BillingUnmatched[];
}

// Memasangkan tagihan dengan pelanggan menurut aturan di atas. Murni: tidak
// mengubah masukannya, dan hasilnya tidak bergantung pada urutan tagihan kecuali
// untuk memilih tagihan mana yang dipakai bila ada dua yang sama-sama persis.
export function matchBilling(
  customers: readonly BillingCustomer[],
  records: readonly BillingRecord[],
  routerName: (routerId: string) => string,
): BillingMatchResult {
  const byExact = new Map<string, BillingCustomer>();
  const byNormalized = new Map<string, BillingCustomer[]>();
  for (const customer of customers) {
    if (!byExact.has(customer.pppoeUsername)) {
      byExact.set(customer.pppoeUsername, customer);
    }
    const key = normalizePppoe(customer.pppoeUsername);
    const group = byNormalized.get(key);
    if (group) group.push(customer);
    else byNormalized.set(key, [customer]);
  }

  const claimed = new Map<
    string,
    { record: BillingRecord; match: "exact" | "normalized" }
  >();
  const reasons: (UnmatchedReason | null)[] = records.map(() => null);

  // Putaran pertama: yang persis. Tagihan persis menang atas yang dirapikan
  // berapa pun urutannya.
  records.forEach((record, index) => {
    const customer = byExact.get(record.pppoeUsername);
    if (!customer) return;
    if (claimed.has(customer.id)) reasons[index] = "duplicate";
    else claimed.set(customer.id, { record, match: "exact" });
  });
  // Putaran kedua: sisanya setelah dirapikan.
  records.forEach((record, index) => {
    if (byExact.has(record.pppoeUsername)) return;
    const candidates = byNormalized.get(normalizePppoe(record.pppoeUsername));
    if (!candidates) reasons[index] = "unknown";
    else if (candidates.length > 1) reasons[index] = "ambiguous";
    else if (claimed.has(candidates[0].id)) reasons[index] = "duplicate";
    else claimed.set(candidates[0].id, { record, match: "normalized" });
  });

  const rows = customers
    .map((customer): BillingRow => {
      const claim = claimed.get(customer.id);
      return {
        customerId: customer.id,
        name: customer.name,
        pppoeUsername: customer.pppoeUsername,
        routerId: customer.routerId,
        routerName: routerName(customer.routerId),
        status: claim ? claim.record.status : customer.billingStatus,
        match: claim ? claim.match : "none",
        invoiceRef: claim ? claim.record.invoiceRef : null,
        billingName: claim ? claim.record.pppoeUsername : null,
      };
    })
    .sort(
      (a, b) =>
        compareText(a.name, b.name) ||
        compareText(a.pppoeUsername, b.pppoeUsername) ||
        compareText(a.customerId, b.customerId),
    );

  const unmatched = records
    .flatMap((record, index): BillingUnmatched[] => {
      const reason = reasons[index];
      return reason
        ? [
            {
              invoiceRef: record.invoiceRef,
              pppoeUsername: record.pppoeUsername,
              status: record.status,
              reason,
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        compareText(a.invoiceRef, b.invoiceRef) ||
        compareText(a.pppoeUsername, b.pppoeUsername),
    );

  return { rows, unmatched };
}

// --- Ringkasan -------------------------------------------------------------

export interface BillingTotals {
  customers: number;
  lunas: number;
  isolir: number;
  // Pelanggan yang tidak mendapat tagihan.
  withoutInvoice: number;
  // Tagihan yang tidak mendapat pelanggan.
  unmatchedInvoices: number;
}

export function summarizeBilling(
  rows: readonly BillingRow[],
  unmatched: readonly BillingUnmatched[],
): BillingTotals {
  const totals: BillingTotals = {
    customers: rows.length,
    lunas: 0,
    isolir: 0,
    withoutInvoice: 0,
    unmatchedInvoices: unmatched.length,
  };
  for (const row of rows) {
    totals[row.status] += 1;
    if (row.match === "none") totals.withoutInvoice += 1;
  }
  return totals;
}

// Yang terakhir selesai di atas; urutan kembar diselesaikan lewat id.
export function sortRuns(runs: readonly BillingSyncRun[]) {
  return [...runs].sort(
    (a, b) => b.finishedAt - a.finishedAt || compareText(b.id, a.id),
  );
}

export interface SyncSummary {
  // Sinkron selesai terakhir, berhasil atau gagal.
  last: BillingSyncRun | null;
  // Sinkron berhasil terakhir: dari sinilah data tagihan di halaman berasal.
  lastSuccess: BillingSyncRun | null;
  // Berapa sinkron gagal berturut-turut sejak yang berhasil terakhir.
  consecutiveFailures: number;
}

export function summarizeSync(runs: readonly BillingSyncRun[]): SyncSummary {
  const sorted = sortRuns(runs);
  const lastSuccessIndex = sorted.findIndex((run) => run.status === "success");
  return {
    last: sorted[0] ?? null,
    lastSuccess: lastSuccessIndex === -1 ? null : sorted[lastSuccessIndex],
    consecutiveFailures:
      lastSuccessIndex === -1 ? sorted.length : lastSuccessIndex,
  };
}

// "tiap jam", "tiap 30 menit", "tiap 2 jam".
export function describeSyncInterval(seconds: number) {
  if (seconds === 3_600) return "tiap jam";
  if (seconds % 3_600 === 0) return `tiap ${seconds / 3_600} jam`;
  if (seconds % 60 === 0) return `tiap ${seconds / 60} menit`;
  return `tiap ${seconds} detik`;
}

export function describeSyncResult(result: BillingSyncResult) {
  const n = formatInteger;
  return `${n(result.invoices)} tagihan terbaca, ${n(result.matched)} cocok, ${n(result.unmatched)} belum cocok`;
}

export type BillingSyncPhase = "running" | "ok" | "failed" | "none";
export type BillingSyncTone = "success" | "warning" | "danger" | "neutral";

export interface BillingSyncStatus {
  phase: BillingSyncPhase;
  // Warna hanya pelengkap: `text` sudah menyebut keadaannya.
  tone: BillingSyncTone;
  // Berapa sinkron gagal berturut-turut (0 bila yang terakhir berhasil).
  failures: number;
  text: string;
}

// Satu kalimat tentang keadaan sinkron. Dipakai kartu sinkron di halaman Billing
// dan ringkasan di halaman Pelanggan, supaya keduanya selalu sepakat. Satu
// kegagalan hanya peringatan; dua atau lebih berturut-turut berarti data sudah
// lebih dari satu jadwal tidak diperbarui.
export function describeSyncState(
  sync: Pick<BillingSyncState, "running"> & {
    runs: readonly BillingSyncRun[];
  },
): BillingSyncStatus {
  const { last, consecutiveFailures } = summarizeSync(sync.runs);
  if (sync.running) {
    return {
      phase: "running",
      tone: "neutral",
      failures: consecutiveFailures,
      text: "Sedang menyinkron",
    };
  }
  if (!last) {
    return {
      phase: "none",
      tone: "neutral",
      failures: 0,
      text: "Belum ada sinkron",
    };
  }
  if (last.status === "success") {
    return {
      phase: "ok",
      tone: "success",
      failures: 0,
      text: "Sinkron terakhir berhasil",
    };
  }
  return consecutiveFailures >= 2
    ? {
        phase: "failed",
        tone: "danger",
        failures: consecutiveFailures,
        text: `Gagal ${formatInteger(consecutiveFailures)} kali berturut-turut`,
      }
    : {
        phase: "failed",
        tone: "warning",
        failures: consecutiveFailures,
        text: "Sinkron terakhir gagal",
      };
}

// Data billing berubah paling cepat sejam sekali, jadi penyegaran berkala
// jarang. Saat sinkron mulai dan selesai, halaman bertanya lebih cepat lewat
// nextBillingRefreshAt (dengan useRefreshAt).
export const BILLING_REFRESH_MS = 30_000;

// Selama sinkron berjalan (hanya beberapa detik), tanyakan tiap selang ini
// supaya selesainya segera terlihat.
export const BILLING_RUNNING_POLL_SECONDS = 5;

// Kapan data perlu ditanyakan lagi di luar penyegaran berkala: tepat saat sinkron
// berikutnya mulai, atau sebentar lagi bila sedang berjalan.
export function nextBillingRefreshAt(
  sync: Pick<BillingSyncState, "running" | "nextRunAt">,
  now: number,
) {
  return sync.running ? now + BILLING_RUNNING_POLL_SECONDS : sync.nextRunAt;
}

// --- Data tiruan -----------------------------------------------------------

// Bagian pelanggan (kira-kira) untuk tiap keadaan. Sengaja cukup besar supaya
// 100 pelanggan tiruan memuat semuanya.
const SHARE_NO_INVOICE = 0.02; // tidak ada tagihan sama sekali
const SHARE_TYPO = 0.02; // billing salah ketik, jadi tagihannya tak bertuan
const SHARE_RESPELLED = 0.07; // huruf besar atau spasi berbeda
const SHARE_DUPLICATE = 0.025; // ada tagihan kedua dengan nama yang sama

// Tagihan untuk nama yang tidak ada di daftar pelanggan (mantan atau calon).
const STRANGER_RECORDS: BillingRecord[] = [
  {
    invoiceRef: "INV-90001",
    pppoeUsername: "mantan.pelanggan01",
    status: "isolir",
  },
  {
    invoiceRef: "INV-90002",
    pppoeUsername: "pelanggan.baru02",
    status: "lunas",
  },
];

// Salah ketik: huruf terakhir hilang. Nama tiruan selalu berakhir tiga angka,
// jadi hasilnya tidak pernah sama dengan nama pelanggan lain.
function withTypo(name: string) {
  return name.slice(0, -1);
}

// Cara billing menulis nama yang sama dengan cara berbeda.
function respell(name: string, seed: number) {
  switch (seed % 4) {
    case 0:
      return name.toUpperCase();
    case 1:
      return `${name} `;
    case 2:
      return ` ${name}`;
    default:
      return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  }
}

// DATA TIRUAN: apa yang akan dibaca backend dari sistem billing, dibuat dari
// pelanggan tiruan. Status tiap tagihan sama dengan status pelanggannya di
// tabel Pelanggan, jadi kedua halaman tidak pernah berbeda pendapat.
export function mockBillingRecords(
  customers: readonly DashboardCustomer[],
): BillingRecord[] {
  const records: BillingRecord[] = [];
  customers.forEach((customer, index) => {
    const seed = hashString(customer.id);
    const invoiceRef = `INV-${10_001 + index}`;
    const roll = unit(seed + 101);
    if (roll < SHARE_NO_INVOICE) return;
    if (roll < SHARE_NO_INVOICE + SHARE_TYPO) {
      records.push({
        invoiceRef,
        pppoeUsername: withTypo(customer.pppoeUsername),
        status: customer.billingStatus,
      });
      return;
    }
    const respelled = roll < SHARE_NO_INVOICE + SHARE_TYPO + SHARE_RESPELLED;
    records.push({
      invoiceRef,
      pppoeUsername: respelled
        ? respell(customer.pppoeUsername, seed)
        : customer.pppoeUsername,
      status: customer.billingStatus,
    });
    // Tagihan kedua hanya untuk nama yang ditulis persis, supaya jelas mana
    // yang dipakai: yang pertama. Statusnya sengaja berbeda, seperti tagihan
    // lama yang belum dihapus dari billing.
    if (!respelled && unit(seed + 211) < SHARE_DUPLICATE) {
      records.push({
        invoiceRef: `${invoiceRef}-B`,
        pppoeUsername: customer.pppoeUsername,
        status: customer.billingStatus === "lunas" ? "isolir" : "lunas",
      });
    }
  });
  return [...records, ...STRANGER_RECORDS];
}

const routerNames = new Map(
  mockRouters.map((router) => [router.id, router.name]),
);
const mockCustomers = createMockCustomers();
const mockRecords = mockBillingRecords(mockCustomers);
const mockMatch = matchBilling(
  mockCustomers,
  mockRecords,
  (routerId) => routerNames.get(routerId) ?? "Router tidak dikenal",
);

const mockTotals = summarizeBilling(mockMatch.rows, mockMatch.unmatched);
const mockResult: BillingSyncResult = {
  invoices: mockRecords.length,
  matched: mockTotals.customers - mockTotals.withoutInvoice,
  unmatched: mockTotals.unmatchedInvoices,
  withoutInvoice: mockTotals.withoutInvoice,
};

// Sinkron mulai menit ke-5 tiap jam (UTC). Lamanya 4 sampai 29 detik, dan
// sekitar 15% gagal dengan salah satu alasan di bawah.
const SYNC_OFFSET_SECONDS = 300;
const FAIL_CHANCE = 0.15;
const MIN_DURATION_SECONDS = 4;
const DURATION_SPREAD_SECONDS = 26;

const FAILURES = [
  "Login ke sistem billing ditolak: nama pengguna atau kata sandi salah.",
  "Token CSRF tidak ditemukan di halaman login billing.",
  "Sistem billing tidak menjawab dalam 30 detik.",
  "Tabel tagihan tidak terbaca: susunan halaman billing berubah.",
];

interface SlotRun {
  slot: number;
  startedAt: number;
  finishedAt: number;
  failed: boolean;
  error: string;
}

// Seluruh isi sinkron ditentukan oleh nomor slotnya saja. `now` hanya menentukan
// slot mana yang sudah mulai, sedang berjalan, atau sudah selesai.
function runInSlot(slot: number): SlotRun {
  const startedAt = slot * BILLING_SYNC_INTERVAL_SECONDS + SYNC_OFFSET_SECONDS;
  const duration =
    MIN_DURATION_SECONDS +
    Math.floor(unit(slot * 5 + 1) * DURATION_SPREAD_SECONDS);
  return {
    slot,
    startedAt,
    finishedAt: startedAt + duration,
    failed: unit(slot * 7 + 2) < FAIL_CHANCE,
    error: FAILURES[Math.floor(unit(slot * 11 + 3) * FAILURES.length)],
  };
}

function toRun(found: SlotRun): BillingSyncRun {
  return {
    id: `billing-sync-${found.slot}`,
    startedAt: found.startedAt,
    finishedAt: found.finishedAt,
    status: found.failed ? "failed" : "success",
    result: found.failed ? null : mockResult,
    error: found.failed ? found.error : null,
  };
}

// Slot terakhir yang sudah mulai pada `now`.
function latestStartedSlot(now: number) {
  return Math.floor(
    (now - SYNC_OFFSET_SECONDS) / BILLING_SYNC_INTERVAL_SECONDS,
  );
}

// Slot terakhir yang sudah SELESAI pada `now` (berhasil atau gagal).
function latestFinishedSlot(now: number) {
  const latest = latestStartedSlot(now);
  return runInSlot(latest).finishedAt > now ? latest - 1 : latest;
}

// DATA TIRUAN: fungsi dari waktu saja, jadi sama setiap dihitung.
export function mockBillingSync(now: number): BillingSyncState {
  const latest = latestStartedSlot(now);
  const current = runInSlot(latest);
  const running = current.finishedAt > now;
  const lastFinished = running ? latest - 1 : latest;
  return {
    intervalSeconds: BILLING_SYNC_INTERVAL_SECONDS,
    running: running ? { startedAt: current.startedAt } : null,
    nextRunAt: runInSlot(latest + 1).startedAt,
    runs: Array.from({ length: BILLING_HISTORY_RUNS }, (_, index) =>
      toRun(runInSlot(lastFinished - index)),
    ),
  };
}

// --- Status tagihan yang berubah mengikuti sinkron -----------------------------

// Sebagian kecil pelanggan yang tagihannya cocok berganti status (Lunas dan
// Isolir) dari sinkron ke sinkron, tiap pelanggan dengan periodenya sendiri
// (8 sampai 47 sinkron, jadi jam). Pelanggan tanpa tagihan yang cocok tidak
// pernah berubah karena sinkron tidak menyentuhnya, dan sinkron yang gagal tidak
// mengubah siapa pun.
const CHANGING_SHARE = 0.12;
const MIN_PERIOD_SLOTS = 8;
const PERIOD_SPREAD_SLOTS = 40;
// Paling jauh berapa sinkron mundur dicari yang berhasil. Sinkron tiruan tidak
// pernah gagal selama itu.
const MAX_FAILED_LOOKBACK = 1_000;

const changing = new Map<string, { period: number; phase: number }>();
for (const row of mockMatch.rows) {
  if (row.match === "none") continue;
  const seed = hashString(row.customerId);
  if (unit(seed + 307) >= CHANGING_SHARE) continue;
  const period = MIN_PERIOD_SLOTS + (seed % PERIOD_SPREAD_SLOTS);
  changing.set(row.customerId, {
    period,
    phase: Math.floor(unit(seed + 311) * period),
  });
}

// Status awal (sebelum sinkron mana pun berubah), dari data pelanggan tiruan.
const baseStatuses = new Map(
  mockCustomers.map((customer) => [customer.id, customer.billingStatus]),
);

// Nomor slot sinkron BERHASIL terakhir yang sudah selesai pada `now`: dari
// sinilah status tagihan yang berlaku berasal.
export function lastSuccessSlot(now: number) {
  let slot = latestFinishedSlot(now);
  for (let i = 0; i < MAX_FAILED_LOOKBACK && runInSlot(slot).failed; i += 1) {
    slot -= 1;
  }
  return slot;
}

// Status tagihan seorang pelanggan menurut hasil sinkron di `slot`, atau null
// untuk id yang tidak dikenal data tiruan. Bergantung pada slot saja, jadi
// berganti persis pada detik sinkron yang berhasil selesai.
export function billingStatusAtSlot(
  customerId: string,
  slot: number,
): BillingStatus | null {
  const base = baseStatuses.get(customerId);
  if (base === undefined) return null;
  const change = changing.get(customerId);
  if (!change) return base;
  const flips = Math.floor((slot + change.phase) / change.period);
  return flips % 2 === 0 ? base : base === "lunas" ? "isolir" : "lunas";
}

export function mockBillingStatusAt(customerId: string, now: number) {
  return billingStatusAtSlot(customerId, lastSuccessSlot(now));
}

// Baris yang sama dengan status lain. Salinannya diingat per baris dan status,
// jadi baris yang kembali ke status yang sama tetap objek yang sama dan tidak
// digambar ulang tanpa perlu.
const variants = new WeakMap<
  BillingRow,
  Partial<Record<BillingStatus, BillingRow>>
>();

function withStatus(row: BillingRow, status: BillingStatus): BillingRow {
  if (row.status === status) return row;
  let byStatus = variants.get(row);
  if (!byStatus) {
    byStatus = {};
    variants.set(row, byStatus);
  }
  return (byStatus[status] ??= { ...row, status });
}

// Baris untuk satu slot, dipakai ulang selama slotnya sama supaya isi yang tidak
// berubah tetap objek yang sama di antara dua penyegaran.
let cachedRows: { slot: number; rows: BillingRow[] } | null = null;

function rowsAtSlot(slot: number): BillingRow[] {
  if (cachedRows?.slot === slot) return cachedRows.rows;
  const rows = mockMatch.rows.map((row) => {
    const status = billingStatusAtSlot(row.customerId, slot);
    return status === null ? row : withStatus(row, status);
  });
  cachedRows = { slot, rows };
  return rows;
}

export function mockBillingOverview(now: number): BillingOverview {
  return {
    sync: mockBillingSync(now),
    rows: rowsAtSlot(lastSuccessSlot(now)),
    unmatched: mockMatch.unmatched,
  };
}

// Menimpa status baris dengan status terbaru dari store (pesan hub), supaya tabel
// dan angka ringkasan di halaman Billing berubah pada saat yang sama dengan lencana
// di halaman Pelanggan dan di peta, tidak menunggu penyegaran berikutnya. Hanya
// baris yang tagihannya cocok: pelanggan tanpa tagihan tidak pernah menerima
// status dari sinkron. Bila tidak ada yang berubah, daftar yang sama dikembalikan;
// baris yang tidak berubah tetap objek yang sama. Tidak mengubah masukannya.
export function withLiveStatuses(
  rows: BillingRow[],
  live: Readonly<Record<string, BillingStatus>>,
): BillingRow[] {
  let changed = false;
  const next = rows.map((row) => {
    const status = live[row.customerId];
    if (row.match === "none" || status === undefined || status === row.status) {
      return row;
    }
    changed = true;
    return withStatus(row, status);
  });
  return changed ? next : rows;
}

// Asal data: "live" dari backend Go, "mock" dari data tiruan.
export type BillingSource = "live" | "mock";

// Menandai asal data pada keadaan sinkron (dibaca kartu sinkron).
export function withBillingSource<T extends BillingSyncState>(
  sync: T,
  source: BillingSource,
): T & { source: BillingSource } {
  return { ...sync, source };
}

// Menandai asal data pada ringkasan billing dan pada `sync` di dalamnya.
export function overviewWithSource(
  overview: BillingOverview,
  source: BillingSource,
): BillingOverview & { source: BillingSource } {
  return {
    ...overview,
    sync: withBillingSource(overview.sync, source),
    source,
  };
}

// Hanya di browser; di server (render, uji tanpa window) langsung data tiruan.
async function fetchOk<T>(path: string): Promise<T | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (res.status !== 200) return null;
    return (await res.json()) as T;
  } catch {
    return null; // offline atau jawaban rusak: pakai data tiruan
  }
}

// GET /api/v1/billing lewat /api/billing; gagal atau offline jatuh ke tiruan.
export async function loadBilling(
  nowSec = Math.floor(Date.now() / 1000),
): Promise<BillingOverview> {
  const mock = mockBillingOverview(nowSec);
  return (
    (await fetchOk<BillingOverview>("/api/billing")) ??
    // Di luar browser data tiruan dikembalikan apa adanya (tanpa `source`).
    (typeof window === "undefined" ? mock : overviewWithSource(mock, "mock"))
  );
}

// Titik ganti ke backend: GET /api/v1/billing/sync. Hanya keadaan sinkron, tanpa
// daftar pelanggan dan tagihan, untuk halaman yang cuma perlu tahu seberapa baru
// data tagihannya (isinya sama dengan `sync` pada GET /api/v1/billing).
export async function loadBillingSync(
  nowSec = Math.floor(Date.now() / 1000),
): Promise<BillingSyncState> {
  const mock = mockBillingSync(nowSec);
  return (
    (await fetchOk<BillingSyncState>("/api/billing/sync")) ??
    (typeof window === "undefined" ? mock : withBillingSource(mock, "mock"))
  );
}
