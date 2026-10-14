import {
  normalizePppoe,
  type BillingRow,
  type BillingUnmatched,
} from "./billing";
import { formatInteger } from "./format";
import type { BillingStatus } from "./types";

// Daftar ketidakcocokan antara tagihan di billing dan pelanggan. Murni, dihitung
// di frontend dari `rows` dan `unmatched` yang sudah ada di kontrak (tidak ada
// endpoint baru), supaya bisa diuji tanpa layar.
//
// Ada dua sisi yang tidak bertemu: tagihan yang tidak punya pelanggan, dan
// pelanggan yang tidak punya tagihan. Sering keduanya satu masalah yang sama,
// misalnya billing salah ketik satu huruf pada nama PPPoE, jadi daftar ini
// mempertemukan keduanya bila nama mereka cukup mirip dan pasangannya jelas.

// Paling banyak berapa huruf berbeda (tambah, hilang, atau ganti) supaya sebuah
// tagihan dan sebuah pelanggan dianggap mungkin satu masalah yang sama.
export const MISMATCH_MAX_DISTANCE = 2;

// Jarak suntingan Levenshtein: paling sedikit berapa huruf yang harus
// ditambah, dihapus, atau diganti untuk mengubah `a` menjadi `b`. Bila jaraknya
// lebih dari `limit` hasilnya hanya dijamin lebih dari `limit` (menghitungnya
// dihentikan lebih awal), jadi cocok untuk membandingkan ratusan nama.
export function editDistance(a: string, b: string, limit = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let smallest = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost,
      );
      current.push(value);
      if (value < smallest) smallest = value;
    }
    // Tiap baris hanya bisa naik dari baris di atasnya, jadi bila semuanya sudah
    // melewati batas, hasil akhirnya pasti melewatinya.
    if (smallest > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

export type MismatchKind =
  | "pair"
  | "invoice-unknown"
  | "invoice-duplicate"
  | "invoice-ambiguous"
  | "customer-without-invoice";

// Urutan di daftar: yang paling bisa langsung dibetulkan lebih dulu.
export const mismatchKinds: readonly MismatchKind[] = [
  "pair",
  "invoice-unknown",
  "invoice-duplicate",
  "invoice-ambiguous",
  "customer-without-invoice",
];

export const mismatchLabels: Record<MismatchKind, string> = {
  pair: "Kemungkinan salah ketik",
  "invoice-unknown": "Tagihan tanpa pelanggan",
  "invoice-duplicate": "Tagihan ganda",
  "invoice-ambiguous": "Cocok dengan banyak pelanggan",
  "customer-without-invoice": "Pelanggan tanpa tagihan",
};

// Dipakai di kalimat ringkasan: "2 kemungkinan salah ketik, ...".
const summaryPhrases: Record<MismatchKind, string> = {
  pair: "kemungkinan salah ketik",
  "invoice-unknown": "tagihan tanpa pelanggan",
  "invoice-duplicate": "tagihan ganda",
  "invoice-ambiguous": "tagihan cocok dengan banyak pelanggan",
  "customer-without-invoice": "pelanggan tanpa tagihan",
};

export interface MismatchInvoice {
  invoiceRef: string;
  // Nama PPPoE persis seperti tertulis di billing.
  pppoeUsername: string;
  status: BillingStatus;
}

export interface MismatchCustomer {
  customerId: string;
  name: string;
  pppoeUsername: string;
  routerName: string;
  // Tagihan yang sekarang dipakai pelanggan itu; null bila tidak punya.
  invoiceRef: string | null;
}

export interface BillingMismatch {
  // Tetap selama isinya sama, untuk kunci daftar.
  id: string;
  kind: MismatchKind;
  invoice: MismatchInvoice | null;
  // Pelanggan yang terlibat: yang disarankan (pair), yang sudah memakai tagihan
  // lain (duplicate), semua yang cocok (ambiguous), atau pelanggan itu sendiri
  // (customer-without-invoice). Kosong untuk tagihan tanpa pelanggan.
  customers: MismatchCustomer[];
  // Jarak nama untuk pair, selain itu null.
  distance: number | null;
}

const compareText = (a: string, b: string) =>
  a.localeCompare(b, "id", { numeric: true });

const asCustomer = (row: BillingRow): MismatchCustomer => ({
  customerId: row.customerId,
  name: row.name,
  pppoeUsername: row.pppoeUsername,
  routerName: row.routerName,
  invoiceRef: row.invoiceRef,
});

const asInvoice = (item: BillingUnmatched): MismatchInvoice => ({
  invoiceRef: item.invoiceRef,
  pppoeUsername: item.pppoeUsername,
  status: item.status,
});

// Indeks nilai terkecil bila hanya ada satu dan jaraknya tidak lebih dari batas;
// -1 bila tidak ada yang cukup dekat, atau ada dua yang sama dekat (tidak
// ditebak).
function uniqueBest(distances: readonly number[]) {
  let best = -1;
  let smallest = Infinity;
  let ties = 0;
  distances.forEach((distance, index) => {
    if (distance < smallest) {
      smallest = distance;
      best = index;
      ties = 1;
    } else if (distance === smallest) {
      ties += 1;
    }
  });
  return smallest <= MISMATCH_MAX_DISTANCE && ties === 1 ? best : -1;
}

// Seluruh ketidakcocokan, urut menurut jenis lalu kode tagihan (atau nama
// pelanggan). Tiap tagihan yang belum cocok dan tiap pelanggan tanpa tagihan
// muncul tepat satu kali. Sepasang tagihan dan pelanggan digabung hanya bila
// masing-masing adalah satu-satunya yang paling mirip bagi yang lain, dengan
// jarak nama paling jauh MISMATCH_MAX_DISTANCE: pasangan yang meragukan lebih
// baik tidak disarankan daripada menyesatkan.
export function buildMismatches(
  rows: readonly BillingRow[],
  unmatched: readonly BillingUnmatched[],
): BillingMismatch[] {
  const withoutInvoice = rows.filter((row) => row.match === "none");
  const unknown = unmatched.filter((item) => item.reason === "unknown");

  const distances = unknown.map((item) =>
    withoutInvoice.map((row) =>
      editDistance(
        normalizePppoe(item.pppoeUsername),
        normalizePppoe(row.pppoeUsername),
        MISMATCH_MAX_DISTANCE,
      ),
    ),
  );
  const pairedInvoice = new Map<
    BillingUnmatched,
    { customer: number; distance: number }
  >();
  const pairedCustomer = new Set<number>();
  unknown.forEach((item, i) => {
    const j = uniqueBest(distances[i]);
    if (j === -1) return;
    if (uniqueBest(distances.map((column) => column[j])) !== i) return;
    pairedInvoice.set(item, { customer: j, distance: distances[i][j] });
    pairedCustomer.add(j);
  });

  const holders = new Map<string, BillingRow[]>();
  for (const row of rows) {
    const key = normalizePppoe(row.pppoeUsername);
    holders.set(key, [...(holders.get(key) ?? []), row]);
  }

  const list: BillingMismatch[] = [];
  // Kunci daftar tidak boleh bergantung pada urutan masukan. Tagihan yang kode dan
  // namanya sama persis (tidak semestinya ada) dibedakan menurut kemunculannya.
  const seen = new Map<string, number>();
  unmatched.forEach((item) => {
    const paired = pairedInvoice.get(item);
    if (paired !== undefined) {
      const row = withoutInvoice[paired.customer];
      list.push({
        id: `pair|${item.invoiceRef}|${row.customerId}`,
        kind: "pair",
        invoice: asInvoice(item),
        customers: [asCustomer(row)],
        distance: paired.distance,
      });
      return;
    }
    const sameName = holders.get(normalizePppoe(item.pppoeUsername)) ?? [];
    const base = `invoice|${item.invoiceRef}|${item.pppoeUsername}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    list.push({
      id: `${base}|${occurrence}`,
      kind:
        item.reason === "duplicate"
          ? "invoice-duplicate"
          : item.reason === "ambiguous"
            ? "invoice-ambiguous"
            : "invoice-unknown",
      invoice: asInvoice(item),
      // Yang sudah memakai tagihan lain (ganda) atau semua yang cocok (banyak).
      customers:
        item.reason === "unknown"
          ? []
          : sameName
              .filter(
                (row) => item.reason === "ambiguous" || row.match !== "none",
              )
              .map(asCustomer),
      distance: null,
    });
  });
  withoutInvoice.forEach((row, j) => {
    if (pairedCustomer.has(j)) return;
    list.push({
      id: `customer|${row.customerId}`,
      kind: "customer-without-invoice",
      invoice: null,
      customers: [asCustomer(row)],
      distance: null,
    });
  });

  const rank = (kind: MismatchKind) => mismatchKinds.indexOf(kind);
  const key = (item: BillingMismatch) =>
    item.invoice?.invoiceRef ?? item.customers[0].name;
  return list.sort(
    (a, b) =>
      rank(a.kind) - rank(b.kind) ||
      compareText(key(a), key(b)) ||
      compareText(a.id, b.id),
  );
}

export type MismatchCounts = Record<MismatchKind, number> & { total: number };

export function summarizeMismatches(
  list: readonly BillingMismatch[],
): MismatchCounts {
  const counts: MismatchCounts = {
    pair: 0,
    "invoice-unknown": 0,
    "invoice-duplicate": 0,
    "invoice-ambiguous": 0,
    "customer-without-invoice": 0,
    total: list.length,
  };
  for (const item of list) counts[item.kind] += 1;
  return counts;
}

// "14 ketidakcocokan: 2 kemungkinan salah ketik, 6 tagihan ganda, ...".
export function describeMismatches(counts: MismatchCounts) {
  if (counts.total === 0) return "Semua tagihan dan pelanggan cocok.";
  const parts = mismatchKinds
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${formatInteger(counts[kind])} ${summaryPhrases[kind]}`);
  return `${formatInteger(counts.total)} ketidakcocokan: ${parts.join(", ")}.`;
}

// Apa yang perlu dilakukan petugas untuk satu ketidakcocokan.
export function mismatchAdvice(item: BillingMismatch) {
  switch (item.kind) {
    case "pair":
      return `Samakan nama PPPoE di billing menjadi ${item.customers[0].pppoeUsername}.`;
    case "invoice-unknown":
      return "Tidak ada pelanggan dengan nama ini. Betulkan nama PPPoE di billing, atau tambahkan pelanggannya.";
    case "invoice-duplicate":
      return `Pelanggan ini sudah memakai tagihan ${item.customers[0]?.invoiceRef ?? "lain"}. Hapus atau gabungkan tagihan ganda di billing.`;
    case "invoice-ambiguous":
      return "Nama ini cocok dengan lebih dari satu pelanggan. Tulis nama PPPoE persis seperti di data pelanggan.";
    case "customer-without-invoice":
      return "Belum ada tagihan dengan nama PPPoE ini. Periksa apakah pelanggan sudah ditagih di billing.";
  }
}

export function filterMismatches(
  list: readonly BillingMismatch[],
  kind: MismatchKind | "all",
  query = "",
): BillingMismatch[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((item) => {
    if (kind !== "all" && item.kind !== kind) return false;
    if (words.length === 0) return true;
    const text = [
      item.invoice?.invoiceRef,
      item.invoice?.pppoeUsername,
      mismatchLabels[item.kind],
      ...item.customers.flatMap((c) => [c.name, c.pppoeUsername, c.routerName]),
    ]
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
