import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BILLING_HISTORY_RUNS,
  BILLING_RUNNING_POLL_SECONDS,
  BILLING_SYNC_INTERVAL_SECONDS,
  describeSyncInterval,
  describeSyncResult,
  describeSyncState,
  matchBilling,
  nextBillingRefreshAt,
  normalizePppoe,
  sortRuns,
  summarizeBilling,
  summarizeSync,
  withLiveStatuses,
  type BillingCustomer,
  type BillingMatch,
  type BillingOverview,
  type BillingRecord,
  type BillingRow,
  type BillingSyncState,
  type UnmatchedReason,
} from "../src/lib/dashboard/billing";
import {
  billingFacetCounts,
  billingRouters,
  defaultBillingFilters,
  filterBillingRows,
} from "../src/lib/dashboard/billing-filter";
import { billingBadge } from "../src/lib/dashboard/billing-badge";
import {
  buildMismatches,
  summarizeMismatches,
} from "../src/lib/dashboard/billing-mismatch";

// KONTRAK LINTAS BAHASA untuk GET /api/v1/billing dan /api/v1/billing/sync.
//
// Tes Go backend/internal/httpapi/billing_pg_test.go (TestBillingGolden...)
// mengisi PostgreSQL sekali pakai dengan data tetap, memanggil kedua endpoint
// lewat handler HTTP sungguhan, dan membandingkan jawabannya BYTE PER BYTE
// dengan dua berkas di backend/internal/httpapi/testdata. Berkas itu hanya ditulis
// ulang dengan UPDATE_GOLDEN=1 saat kontraknya sengaja berubah:
//
//   UPDATE_GOLDEN=1 npm test      (lalu periksa selisihnya di git)
//
// Spesifikasi ini menutup lingkarannya dari sisi TypeScript. Ia membaca berkas
// yang sama dan menegaskan tiga hal:
//
//   1. BENTUK: validator tulisan tangan di bawah, disusun dari tipe
//      BillingOverview dan BillingSyncState di src/lib/dashboard/billing.ts,
//      menolak bidang yang hilang, bidang liar, tipe yang salah, enum di luar
//      daftar, waktu yang bukan detik epoch bulat, urutan yang salah, dan
//      hitungan yang tidak sejalan. Validatornya sendiri diuji dengan mutasi:
//      tiap perubahan satu bidang pada salinan golden harus membuat ia
//      melaporkan masalah.
//   2. ATURAN: matchBilling (pencocokan di frontend) dijalankan ulang dari isi
//      golden dan harus menghasilkan baris dan tagihan tak bertuan yang sama
//      persis, termasuk urutan. Itu membuktikan backend Go dan frontend
//      sepakat tentang pencocokan DAN urutan teks (localeCompare "id" numerik).
//   3. PEMAKAIAN: fungsi frontend yang sungguhan memakai bentuk ini
//      (summarizeSync, describeSyncState, buildMismatches, filter, dst.)
//      dijalankan pada golden tanpa galat dan memberi jawaban yang masuk akal.
//
// Isi golden dibuat konsisten dengan sinkron berhasil terakhir, jadi hitungan
// pada sinkron itu juga harus sama dengan isi `rows` dan `unmatched`.
//
// Catatan batas: validator tidak bisa tahu bahwa `routerName` seharusnya
// "RTR-Barat-02"; perubahan isi seperti itu ditangkap tes Go (golden byte per
// byte), sedangkan perubahan BENTUK ditangkap di sini. Keduanya bersama
// menjaga kontrak.

const OVERVIEW_PATH = fileURLToPath(
  new URL(
    "../backend/internal/httpapi/testdata/billing_overview.golden.json",
    import.meta.url,
  ),
);
const SYNC_PATH = fileURLToPath(
  new URL(
    "../backend/internal/httpapi/testdata/billing_sync.golden.json",
    import.meta.url,
  ),
);

type Json = unknown;
type Obj = Record<string, Json>;

const overviewText = readFileSync(OVERVIEW_PATH, "utf8");
const syncText = readFileSync(SYNC_PATH, "utf8");
const overviewEnvelope = JSON.parse(overviewText) as Json;
const syncEnvelope = JSON.parse(syncText) as Json;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// --- Validator bentuk -------------------------------------------------------

const isObject = (value: Json): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collator = new Intl.Collator("id", { numeric: true });
// Sama dengan compareText di billing.ts: a.localeCompare(b, "id", {numeric: true}).
const compareText = (a: string, b: string) =>
  a.localeCompare(b, "id", { numeric: true });

const STATUSES = ["lunas", "isolir"] as const;
const MATCHES: readonly BillingMatch[] = ["exact", "normalized", "none"];
const REASONS: readonly UnmatchedReason[] = [
  "unknown",
  "duplicate",
  "ambiguous",
];
const RUN_STATUSES = ["success", "failed"] as const;

// Detik epoch tahun 2001 sampai 2286; milidetik (1,7 triliun) tidak lolos.
const EPOCH_MIN = 1_000_000_000;
const EPOCH_MAX = 10_000_000_000;

class Checker {
  readonly problems: string[] = [];

  fail(path: string, message: string) {
    this.problems.push(`${path}: ${message}`);
  }

  // Objek dengan kunci PERSIS ini: tidak kurang, tidak lebih.
  object(path: string, value: Json, keys: readonly string[]): Obj | null {
    if (!isObject(value)) {
      this.fail(path, `bukan objek (${typeof value})`);
      return null;
    }
    for (const key of keys) {
      if (!(key in value)) this.fail(`${path}.${key}`, "hilang");
    }
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) this.fail(`${path}.${key}`, "bidang liar");
    }
    return value;
  }

  string(path: string, value: Json, nonEmpty = false) {
    if (typeof value !== "string") {
      this.fail(path, `bukan teks (${JSON.stringify(value)})`);
    } else if (nonEmpty && value.trim() === "") {
      this.fail(path, "teks kosong");
    }
  }

  nullableString(path: string, value: Json, nonEmpty = false) {
    if (value !== null) this.string(path, value, nonEmpty);
  }

  integer(path: string, value: Json, min = 0) {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      this.fail(path, `bukan bilangan bulat (${JSON.stringify(value)})`);
    } else if (value < min) {
      this.fail(path, `kurang dari ${min} (${value})`);
    }
  }

  epoch(path: string, value: Json) {
    this.integer(path, value);
    if (typeof value === "number" && Number.isInteger(value)) {
      if (value < EPOCH_MIN || value >= EPOCH_MAX) {
        this.fail(path, `bukan detik epoch (${value}); milidetik?`);
      }
    }
  }

  oneOf<T extends string>(path: string, value: Json, allowed: readonly T[]) {
    if (typeof value !== "string" || !allowed.includes(value as T)) {
      this.fail(path, `bukan salah satu dari ${allowed.join("|")} (${JSON.stringify(value)})`);
    }
  }
}

function checkSyncState(c: Checker, path: string, value: Json) {
  const sync = c.object(path, value, [
    "intervalSeconds",
    "running",
    "nextRunAt",
    "runs",
  ]);
  if (!sync) return;
  c.integer(`${path}.intervalSeconds`, sync.intervalSeconds, 1);
  c.epoch(`${path}.nextRunAt`, sync.nextRunAt);

  let runningStart: number | null = null;
  if (sync.running !== null) {
    const running = c.object(`${path}.running`, sync.running, ["startedAt"]);
    if (running) {
      c.epoch(`${path}.running.startedAt`, running.startedAt);
      if (typeof running.startedAt === "number") runningStart = running.startedAt;
    }
  }

  if (!Array.isArray(sync.runs)) {
    c.fail(`${path}.runs`, "bukan larik");
    return;
  }
  if (sync.runs.length > BILLING_HISTORY_RUNS) {
    c.fail(`${path}.runs`, `${sync.runs.length} sinkron, paling banyak ${BILLING_HISTORY_RUNS}`);
  }
  let previousFinish = Infinity;
  let newestFinish = -Infinity;
  const ids = new Set<string>();
  sync.runs.forEach((entry, index) => {
    const at = `${path}.runs[${index}]`;
    const run = c.object(at, entry, [
      "id",
      "startedAt",
      "finishedAt",
      "status",
      "result",
      "error",
    ]);
    if (!run) return;
    c.string(`${at}.id`, run.id, true);
    if (typeof run.id === "string") {
      if (ids.has(run.id)) c.fail(`${at}.id`, "kembar");
      ids.add(run.id);
    }
    c.epoch(`${at}.startedAt`, run.startedAt);
    c.epoch(`${at}.finishedAt`, run.finishedAt);
    if (typeof run.startedAt === "number" && typeof run.finishedAt === "number") {
      if (run.finishedAt < run.startedAt) c.fail(at, "selesai sebelum mulai");
      // Terbaru di atas: finishedAt menurun tegas.
      if (run.finishedAt >= previousFinish) {
        c.fail(at, "tidak lebih lama dari sinkron di atasnya (urutan harus menurun)");
      }
      previousFinish = run.finishedAt;
      newestFinish = Math.max(newestFinish, run.finishedAt);
    }
    c.oneOf(`${at}.status`, run.status, RUN_STATUSES);
    if (run.status === "success") {
      const result = c.object(`${at}.result`, run.result, [
        "invoices",
        "matched",
        "unmatched",
        "withoutInvoice",
      ]);
      if (result) {
        for (const key of ["invoices", "matched", "unmatched", "withoutInvoice"]) {
          c.integer(`${at}.result.${key}`, result[key]);
        }
        if (
          typeof result.invoices === "number" &&
          typeof result.matched === "number" &&
          typeof result.unmatched === "number" &&
          result.invoices !== result.matched + result.unmatched
        ) {
          c.fail(
            `${at}.result`,
            `invoices ${result.invoices} bukan matched ${result.matched} + unmatched ${result.unmatched}`,
          );
        }
      }
      if (run.error !== null) c.fail(`${at}.error`, "harus null bila berhasil");
    } else if (run.status === "failed") {
      if (run.result !== null) c.fail(`${at}.result`, "harus null bila gagal");
      c.string(`${at}.error`, run.error, true);
    }
  });

  // nextRunAt selalu setelah semua yang sudah terjadi.
  if (typeof sync.nextRunAt === "number") {
    if (sync.nextRunAt <= newestFinish) {
      c.fail(`${path}.nextRunAt`, "tidak setelah sinkron terakhir yang selesai");
    }
    if (runningStart !== null && sync.nextRunAt <= runningStart) {
      c.fail(`${path}.nextRunAt`, "tidak setelah sinkron yang sedang berjalan");
    }
  }
}

function checkRows(c: Checker, path: string, value: Json) {
  if (!Array.isArray(value)) {
    c.fail(path, "bukan larik");
    return;
  }
  const ids = new Set<string>();
  // Satu router, satu nama: baris yang sama routerId-nya harus sama routerName-nya,
  // dan dua router tidak boleh berbagi nama.
  const routerNameById = new Map<string, string>();
  const routerIdByName = new Map<string, string>();
  value.forEach((entry, index) => {
    const at = `${path}[${index}]`;
    const row = c.object(at, entry, [
      "customerId",
      "name",
      "pppoeUsername",
      "routerId",
      "routerName",
      "status",
      "match",
      "invoiceRef",
      "billingName",
    ]);
    if (!row) return;
    for (const key of ["customerId", "name", "pppoeUsername", "routerId", "routerName"]) {
      c.string(`${at}.${key}`, row[key], true);
    }
    if (typeof row.customerId === "string") {
      if (ids.has(row.customerId)) c.fail(`${at}.customerId`, "kembar (satu baris per pelanggan)");
      ids.add(row.customerId);
    }
    if (typeof row.routerId === "string" && typeof row.routerName === "string") {
      const knownName = routerNameById.get(row.routerId);
      if (knownName !== undefined && knownName !== row.routerName) {
        c.fail(`${at}.routerName`, `router ${row.routerId} bernama "${knownName}" di baris lain`);
      }
      routerNameById.set(row.routerId, row.routerName);
      const knownId = routerIdByName.get(row.routerName);
      if (knownId !== undefined && knownId !== row.routerId) {
        c.fail(`${at}.routerId`, `nama router "${row.routerName}" dipakai router lain`);
      }
      routerIdByName.set(row.routerName, row.routerId);
    }
    c.oneOf(`${at}.status`, row.status, STATUSES);
    c.oneOf(`${at}.match`, row.match, MATCHES);
    c.nullableString(`${at}.invoiceRef`, row.invoiceRef, true);
    c.nullableString(`${at}.billingName`, row.billingName, true);
    if (row.match === "none") {
      // README: invoiceRef dan billingName null tepat bila match "none".
      if (row.invoiceRef !== null) c.fail(`${at}.invoiceRef`, "harus null bila match none");
      if (row.billingName !== null) c.fail(`${at}.billingName`, "harus null bila match none");
    } else if (row.match === "exact" || row.match === "normalized") {
      // invoiceRef boleh null hanya bila tagihannya memang tanpa kode.
      if (typeof row.billingName !== "string") {
        c.fail(`${at}.billingName`, "harus terisi bila ada tagihan yang cocok");
      } else if (typeof row.pppoeUsername === "string") {
        if (row.match === "exact" && row.billingName !== row.pppoeUsername) {
          c.fail(`${at}.billingName`, "match exact harus sama persis dengan pppoeUsername");
        }
        if (
          row.match === "normalized" &&
          (row.billingName === row.pppoeUsername ||
            normalizePppoe(row.billingName) !== normalizePppoe(row.pppoeUsername))
        ) {
          c.fail(`${at}.billingName`, "match normalized harus sama setelah dirapikan, bukan sebelumnya");
        }
      }
    }
  });
  // Urut nama, lalu username PPPoE, lalu id (seperti matchBilling).
  for (let i = 1; i < value.length; i += 1) {
    const a = value[i - 1] as Obj;
    const b = value[i] as Obj;
    if (!isObject(a) || !isObject(b)) continue;
    if (
      typeof a.name !== "string" || typeof b.name !== "string" ||
      typeof a.pppoeUsername !== "string" || typeof b.pppoeUsername !== "string" ||
      typeof a.customerId !== "string" || typeof b.customerId !== "string"
    ) continue;
    const order =
      collator.compare(a.name, b.name) ||
      collator.compare(a.pppoeUsername, b.pppoeUsername) ||
      collator.compare(a.customerId, b.customerId);
    if (order > 0) c.fail(`${path}[${i}]`, "urutan salah (nama, username PPPoE, id)");
  }
}

function checkUnmatched(c: Checker, path: string, value: Json) {
  if (!Array.isArray(value)) {
    c.fail(path, "bukan larik");
    return;
  }
  value.forEach((entry, index) => {
    const at = `${path}[${index}]`;
    const item = c.object(at, entry, [
      "invoiceRef",
      "pppoeUsername",
      "status",
      "reason",
    ]);
    if (!item) return;
    // Di TypeScript invoiceRef bertipe string (bukan null); tagihan tanpa kode
    // ditulis "".
    c.string(`${at}.invoiceRef`, item.invoiceRef);
    c.string(`${at}.pppoeUsername`, item.pppoeUsername, true);
    c.oneOf(`${at}.status`, item.status, STATUSES);
    c.oneOf(`${at}.reason`, item.reason, REASONS);
  });
  for (let i = 1; i < value.length; i += 1) {
    const a = value[i - 1] as Obj;
    const b = value[i] as Obj;
    if (
      !isObject(a) || !isObject(b) ||
      typeof a.invoiceRef !== "string" || typeof b.invoiceRef !== "string" ||
      typeof a.pppoeUsername !== "string" || typeof b.pppoeUsername !== "string"
    ) continue;
    const order =
      collator.compare(a.invoiceRef, b.invoiceRef) ||
      collator.compare(a.pppoeUsername, b.pppoeUsername);
    if (order > 0) c.fail(`${path}[${i}]`, "urutan salah (kode tagihan, lalu nama)");
  }
}

// Seluruh jawaban GET /api/v1/billing.
function validateOverviewResponse(value: Json): string[] {
  const c = new Checker();
  const envelope = c.object("respons", value, ["data"]);
  if (!envelope) return c.problems;
  const data = c.object("data", envelope.data, ["sync", "rows", "unmatched"]);
  if (!data) return c.problems;
  checkSyncState(c, "data.sync", data.sync);
  checkRows(c, "data.rows", data.rows);
  checkUnmatched(c, "data.unmatched", data.unmatched);
  return c.problems;
}

// Seluruh jawaban GET /api/v1/billing/sync.
function validateSyncResponse(value: Json): string[] {
  const c = new Checker();
  const envelope = c.object("respons", value, ["data"]);
  if (!envelope) return c.problems;
  checkSyncState(c, "data", envelope.data);
  return c.problems;
}

const overview = (overviewEnvelope as { data: BillingOverview }).data;
const syncOnly = (syncEnvelope as { data: BillingSyncState }).data;

// --- 1. Bentuk --------------------------------------------------------------

test.describe("bentuk jawaban terhadap tipe TypeScript", () => {
  test("golden /api/v1/billing lolos validator", () => {
    expect(validateOverviewResponse(overviewEnvelope)).toEqual([]);
  });

  test("golden /api/v1/billing/sync lolos validator", () => {
    expect(validateSyncResponse(syncEnvelope)).toEqual([]);
  });

  test("/sync adalah persis objek sync dari /billing", () => {
    expect(syncOnly).toEqual(overview.sync);
  });

  test("berkas golden murni ASCII dan angkanya bilangan bulat", () => {
    // Karakter bukan-ASCII ditulis \uXXXX supaya editor yang menormalkan Unicode
    // tidak mengubah berkas; angka pecahan atau eksponen tidak boleh ada.
    for (const text of [overviewText, syncText]) {
      expect(text).not.toMatch(/[^ -~\r\n]/);
      expect(text).not.toMatch(/:\s*-?\d+(\.\d+|[eE][+-]?\d+)/);
    }
  });

  test("isinya cukup beragam untuk berarti", () => {
    // Bila seed Go diubah sehingga ini berkurang, kontraknya tak lagi teruji.
    expect(overview.sync.runs).toHaveLength(BILLING_HISTORY_RUNS);
    expect(overview.sync.running).not.toBeNull();
    const statuses = new Set(overview.sync.runs.map((run) => run.status));
    expect([...statuses].sort()).toEqual(["failed", "success"]);
    expect(new Set(overview.rows.map((row) => row.match))).toEqual(
      new Set(MATCHES),
    );
    expect(new Set(overview.rows.map((row) => row.status))).toEqual(
      new Set(STATUSES),
    );
    expect(new Set(overview.unmatched.map((item) => item.reason))).toEqual(
      new Set(REASONS),
    );
    expect(overview.rows.some((row) => row.invoiceRef === null && row.match !== "none")).toBe(true);
    expect(overview.unmatched.some((item) => item.invoiceRef === "")).toBe(true);
    expect(new Set(overview.rows.map((row) => row.routerId)).size).toBeGreaterThan(1);
  });

  test("konstanta kontrak sama dengan golden", () => {
    expect(overview.sync.intervalSeconds).toBe(BILLING_SYNC_INTERVAL_SECONDS);
    expect(describeSyncInterval(overview.sync.intervalSeconds)).toBe("tiap jam");
    expect(overview.sync.runs.length).toBeLessThanOrEqual(BILLING_HISTORY_RUNS);
  });

  test("hitungan sinkron berhasil terakhir sejalan dengan rows dan unmatched", () => {
    const { lastSuccess } = summarizeSync(overview.sync.runs);
    expect(lastSuccess?.result).toBeTruthy();
    const result = lastSuccess!.result!;
    expect(result.matched).toBe(
      overview.rows.filter((row) => row.match !== "none").length,
    );
    expect(result.withoutInvoice).toBe(
      overview.rows.filter((row) => row.match === "none").length,
    );
    // Hanya tagihan tak bertuan dari sinkron terbaru; yang lama tidak ikut.
    expect(result.unmatched).toBe(overview.unmatched.length);
    expect(result.invoices).toBe(result.matched + result.unmatched);
  });
});

// Validator harus menangkap tiap jenis penyimpangan. Setiap kasus mengubah SATU
// bidang pada salinan golden dan menuntut sedikitnya satu masalah dilaporkan.
test.describe("validator menangkap perubahan satu bidang", () => {
  type Mutation = {
    name: string;
    apply: (envelope: { data: BillingOverview }) => void;
  };
  const mutations: Mutation[] = [
    { name: "waktu dalam milidetik", apply: (e) => { e.data.sync.nextRunAt *= 1000; } },
    { name: "waktu pecahan", apply: (e) => { e.data.sync.runs[0].startedAt += 0.5; } },
    { name: "waktu sebagai teks", apply: (e) => { (e.data.sync.runs[0] as unknown as Obj).finishedAt = "1777626311"; } },
    { name: "nama bidang nextRunAt diganti", apply: (e) => { const s = e.data.sync as unknown as Obj; s.next_run_at = s.nextRunAt; delete s.nextRunAt; } },
    { name: "bidang liar di sync", apply: (e) => { (e.data.sync as unknown as Obj).extra = 1; } },
    { name: "running dihilangkan (bukan null)", apply: (e) => { delete (e.data.sync as unknown as Obj).running; } },
    { name: "running tanpa startedAt", apply: (e) => { (e.data.sync as unknown as Obj).running = {}; } },
    { name: "riwayat melebihi 24", apply: (e) => { e.data.sync.runs.push(clone(e.data.sync.runs[0])); } },
    { name: "riwayat tidak menurun", apply: (e) => { e.data.sync.runs.reverse(); } },
    { name: "hitungan tidak berjumlah", apply: (e) => { e.data.sync.runs.find((r) => r.result)!.result!.matched += 1; } },
    { name: "sinkron berhasil tanpa result", apply: (e) => { e.data.sync.runs.find((r) => r.status === "success")!.result = null; } },
    { name: "sinkron gagal dengan result", apply: (e) => { e.data.sync.runs.find((r) => r.status === "failed")!.result = { invoices: 0, matched: 0, unmatched: 0, withoutInvoice: 0 }; } },
    { name: "sinkron gagal tanpa pesan", apply: (e) => { e.data.sync.runs.find((r) => r.status === "failed")!.error = null; } },
    { name: "status sinkron di luar enum", apply: (e) => { (e.data.sync.runs[0] as unknown as Obj).status = "running"; } },
    { name: "nextRunAt sebelum sinkron terakhir", apply: (e) => { e.data.sync.nextRunAt = e.data.sync.runs[0].finishedAt - 1; } },
    { name: "id sinkron kembar", apply: (e) => { e.data.sync.runs[1].id = e.data.sync.runs[0].id; } },
    { name: "baris diacak", apply: (e) => { [e.data.rows[0], e.data.rows[2]] = [e.data.rows[2], e.data.rows[0]]; } },
    { name: "status baris di luar enum", apply: (e) => { (e.data.rows[0] as unknown as Obj).status = "Lunas"; } },
    { name: "match di luar enum", apply: (e) => { (e.data.rows[0] as unknown as Obj).match = "fuzzy"; } },
    { name: "invoiceRef dihilangkan (bukan null)", apply: (e) => { delete (e.data.rows[0] as unknown as Obj).invoiceRef; } },
    { name: "match none tetapi invoiceRef terisi", apply: (e) => { const row = e.data.rows.find((r) => r.match === "none")!; row.invoiceRef = "INV-1"; } },
    { name: "match exact tanpa billingName", apply: (e) => { e.data.rows.find((r) => r.match === "exact")!.billingName = null; } },
    { name: "match exact tetapi nama beda", apply: (e) => { e.data.rows.find((r) => r.match === "exact")!.billingName = "lain"; } },
    { name: "match normalized padahal sama persis", apply: (e) => { const row = e.data.rows.find((r) => r.match === "normalized")!; row.billingName = row.pppoeUsername; } },
    { name: "nama router berbeda untuk router yang sama", apply: (e) => { e.data.rows[0].routerName = "RTR-Lain"; } },
    { name: "satu pelanggan dua baris", apply: (e) => { e.data.rows.push(clone(e.data.rows[0])); } },
    { name: "tagihan tak bertuan diacak", apply: (e) => { e.data.unmatched.reverse(); } },
    { name: "alasan di luar enum", apply: (e) => { (e.data.unmatched[0] as unknown as Obj).reason = "orphan"; } },
    { name: "invoiceRef tak bertuan null", apply: (e) => { (e.data.unmatched[0] as unknown as Obj).invoiceRef = null; } },
    { name: "rows null", apply: (e) => { (e.data as unknown as Obj).rows = null; } },
    { name: "unmatched hilang", apply: (e) => { delete (e.data as unknown as Obj).unmatched; } },
  ];

  for (const mutation of mutations) {
    test(mutation.name, () => {
      const copy = clone(overviewEnvelope) as { data: BillingOverview };
      mutation.apply(copy);
      expect(validateOverviewResponse(copy)).not.toEqual([]);
    });
  }

  test("amplop tanpa data dan data sebagai larik ditolak", () => {
    expect(validateOverviewResponse({})).not.toEqual([]);
    expect(validateOverviewResponse({ data: [] })).not.toEqual([]);
    expect(validateSyncResponse({ data: overview })).not.toEqual([]);
    expect(validateSyncResponse({ data: syncOnly, extra: 1 })).not.toEqual([]);
  });
});

// --- 2. Aturan: matchBilling dari isi golden -----------------------------------

test("matchBilling menghasilkan ulang baris dan tagihan tak bertuan dari golden", () => {
  // Dari golden disusun masukan matchBilling: pelanggan (dengan status yang
  // berlaku sebagai status tersimpan) dan tagihan (yang cocok lebih dulu, lalu
  // yang tak bertuan; urutan itu menentukan tagihan ganda mana yang dipakai).
  const customers: BillingCustomer[] = overview.rows.map((row) => ({
    id: row.customerId,
    name: row.name,
    pppoeUsername: row.pppoeUsername,
    routerId: row.routerId,
    billingStatus: row.status,
  }));
  const records: BillingRecord[] = [
    ...overview.rows
      .filter((row) => row.match !== "none")
      .map((row) => ({
        invoiceRef: row.invoiceRef ?? "",
        pppoeUsername: row.billingName!,
        status: row.status,
      })),
    ...overview.unmatched.map((item) => ({
      invoiceRef: item.invoiceRef,
      pppoeUsername: item.pppoeUsername,
      status: item.status,
    })),
  ];
  const routerNames = new Map(overview.rows.map((row) => [row.routerId, row.routerName]));
  const result = matchBilling(customers, records, (id) => routerNames.get(id) ?? "?");

  // matchBilling memakai "" untuk tagihan tanpa kode; backend menulis null.
  const expectedRows: BillingRow[] = result.rows.map((row) => ({
    ...row,
    invoiceRef: row.invoiceRef === "" ? null : row.invoiceRef,
  }));
  expect(overview.rows).toEqual(expectedRows);
  expect(overview.unmatched).toEqual(result.unmatched);
});

test("urutan baris golden sama dengan urutan yang dihasilkan localeCompare", () => {
  const resorted = [...overview.rows].sort(
    (a, b) =>
      compareText(a.name, b.name) ||
      compareText(a.pppoeUsername, b.pppoeUsername) ||
      compareText(a.customerId, b.customerId),
  );
  expect(overview.rows.map((row) => row.customerId)).toEqual(
    resorted.map((row) => row.customerId),
  );
  const unmatchedResorted = [...overview.unmatched].sort(
    (a, b) =>
      compareText(a.invoiceRef, b.invoiceRef) ||
      compareText(a.pppoeUsername, b.pppoeUsername),
  );
  expect(overview.unmatched).toEqual(unmatchedResorted);
});

// --- 3. Pemakaian: fungsi frontend yang sungguhan -----------------------------

test.describe("fungsi frontend memakai bentuk ini", () => {
  test("ringkasan dan keadaan sinkron", () => {
    const summary = summarizeSync(overview.sync.runs);
    expect(summary.last).toBe(overview.sync.runs[0]);
    expect(summary.last?.status).toBe("failed");
    expect(summary.lastSuccess?.status).toBe("success");
    // Dua sinkron terbaru gagal sebelum yang berhasil.
    expect(summary.consecutiveFailures).toBe(2);
    expect(sortRuns(overview.sync.runs)).toEqual(overview.sync.runs);

    const running = describeSyncState(overview.sync);
    expect(running).toMatchObject({ phase: "running", tone: "neutral", failures: 2 });
    const idle = describeSyncState({ running: null, runs: overview.sync.runs });
    expect(idle).toMatchObject({
      phase: "failed",
      tone: "danger",
      failures: 2,
    });
    expect(idle.text).toContain("2");
    const afterSuccess = describeSyncState({
      running: null,
      runs: overview.sync.runs.slice(2),
    });
    expect(afterSuccess).toMatchObject({ phase: "ok", tone: "success", failures: 0 });
    expect(describeSyncResult(summary.lastSuccess!.result!)).toMatch(
      /tagihan terbaca, .* cocok, .* belum cocok/,
    );
  });

  test("kapan halaman bertanya lagi", () => {
    const now = overview.sync.running!.startedAt + 3;
    expect(nextBillingRefreshAt(overview.sync, now)).toBe(
      now + BILLING_RUNNING_POLL_SECONDS,
    );
    const idle = { running: null, nextRunAt: overview.sync.nextRunAt };
    expect(nextBillingRefreshAt(idle, now)).toBe(overview.sync.nextRunAt);
    expect(overview.sync.nextRunAt).toBeGreaterThan(now);
    // Jadwal jam-jaman: sinkron berikutnya paling lama satu jam setelah yang
    // sedang berjalan mulai.
    expect(overview.sync.nextRunAt - overview.sync.running!.startedAt).toBe(
      BILLING_SYNC_INTERVAL_SECONDS,
    );
  });

  test("total, lencana, dan penimpaan status", () => {
    const totals = summarizeBilling(overview.rows, overview.unmatched);
    expect(totals.customers).toBe(overview.rows.length);
    expect(totals.lunas + totals.isolir).toBe(totals.customers);
    expect(totals.withoutInvoice).toBe(
      overview.rows.filter((row) => row.match === "none").length,
    );
    expect(totals.unmatchedInvoices).toBe(overview.unmatched.length);
    for (const row of overview.rows) {
      expect(billingBadge(row.status).tone).toBe(
        row.status === "lunas" ? "success" : "danger",
      );
    }
    // Tanpa status hidup, daftar yang sama dikembalikan apa adanya.
    expect(withLiveStatuses(overview.rows, {})).toBe(overview.rows);
    const first = overview.rows.find((row) => row.match !== "none")!;
    const flipped = first.status === "lunas" ? "isolir" : "lunas";
    const live = withLiveStatuses(overview.rows, { [first.customerId]: flipped });
    expect(live.find((row) => row.customerId === first.customerId)?.status).toBe(flipped);
  });

  test("saringan dan hitungan per pilihan", () => {
    const counts = billingFacetCounts(overview.rows, defaultBillingFilters);
    expect(counts.total).toBe(overview.rows.length);
    expect(counts.status.lunas + counts.status.isolir).toBe(overview.rows.length);
    expect(counts.match.exact + counts.match.normalized + counts.match.none).toBe(
      overview.rows.length,
    );
    const routers = billingRouters(overview.rows);
    expect(routers.length).toBeGreaterThan(1);
    expect(
      routers.reduce((sum, router) => sum + counts.router[router.id], 0),
    ).toBe(overview.rows.length);
    for (const status of STATUSES) {
      expect(
        filterBillingRows(overview.rows, { ...defaultBillingFilters, status }),
      ).toHaveLength(counts.status[status]);
    }
    // Pencarian memakai teks yang ditampilkan, termasuk huruf beraksen.
    expect(
      filterBillingRows(overview.rows, { ...defaultBillingFilters, query: "zoë" }),
    ).not.toHaveLength(0);
  });

  test("daftar ketidakcocokan memuat tiap tagihan tak bertuan dan pelanggan tanpa tagihan tepat sekali", () => {
    const list = buildMismatches(overview.rows, overview.unmatched);
    expect(list.filter((item) => item.invoice !== null)).toHaveLength(
      overview.unmatched.length,
    );
    const withoutInvoice = overview.rows
      .filter((row) => row.match === "none")
      .map((row) => row.customerId)
      .sort();
    const listed = list
      .filter(
        (item) =>
          item.kind === "customer-without-invoice" || item.kind === "pair",
      )
      .flatMap((item) => item.customers.map((customer) => customer.customerId))
      .sort();
    expect(listed).toEqual(withoutInvoice);
    expect(new Set(list.map((item) => item.id)).size).toBe(list.length);
    const counts = summarizeMismatches(list);
    expect(counts.total).toBe(list.length);
    // Ketiga alasan tiba di frontend sebagai jenis yang dikenalnya.
    expect(counts["invoice-unknown"]).toBeGreaterThan(0);
    expect(counts["invoice-duplicate"]).toBeGreaterThan(0);
    expect(counts["invoice-ambiguous"]).toBeGreaterThan(0);
  });
});
