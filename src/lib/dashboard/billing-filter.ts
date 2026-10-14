import {
  billingMatchLabels,
  billingStatusLabels,
  type BillingMatch,
  type BillingRow,
} from "./billing";
import type { BillingStatus } from "./types";

// Pencarian dan saringan tabel status billing. Murni, supaya bisa diuji tanpa
// layar: komponen hanya menyimpan pilihan saringannya.

export interface BillingFilters {
  // Kata kunci bebas; spasi memisahkan beberapa kata yang semuanya harus ada.
  query: string;
  status: BillingStatus | "all";
  match: BillingMatch | "all";
  // "all" atau id router.
  routerId: string;
}

export const defaultBillingFilters: BillingFilters = {
  query: "",
  status: "all",
  match: "all",
  routerId: "all",
};

export function hasActiveBillingFilters(filters: BillingFilters) {
  return (
    filters.query.trim() !== "" ||
    filters.status !== "all" ||
    filters.match !== "all" ||
    filters.routerId !== "all"
  );
}

// Kata kunci menjadi kata-kata kecil; kosong bila tidak ada yang dicari.
export function billingSearchTerms(query: string) {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

// Teks yang tampil di baris, jadi apa yang terbaca di layar bisa dicari: nama,
// username PPPoE, router, kode tagihan, serta tulisan status dan pencocokannya.
// Nama PPPoE seperti tertulis di billing tidak perlu ditambahkan: tulisan itu
// hanya berbeda huruf besar dan spasi di ujung dari username (itulah syarat
// "cocok setelah dirapikan"), dan pencarian tidak membedakan huruf dan memecah
// kata, jadi username sudah menemukannya.
export function billingSearchText(row: BillingRow) {
  return [
    row.name,
    row.pppoeUsername,
    row.routerName,
    billingStatusLabels[row.status],
    row.invoiceRef,
    billingMatchLabels[row.match],
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();
}

type Dimension = "query" | "status" | "match" | "routerId";

// `skip` mengabaikan satu saringan, untuk menghitung angka di samping pilihan
// saringan itu sendiri.
function matches(
  row: BillingRow,
  filters: BillingFilters,
  terms: string[],
  text: string,
  skip?: Dimension,
) {
  if (skip !== "status" && filters.status !== "all") {
    if (row.status !== filters.status) return false;
  }
  if (skip !== "match" && filters.match !== "all") {
    if (row.match !== filters.match) return false;
  }
  if (skip !== "routerId" && filters.routerId !== "all") {
    if (row.routerId !== filters.routerId) return false;
  }
  if (skip !== "query" && terms.length > 0) {
    if (!terms.every((term) => text.includes(term))) return false;
  }
  return true;
}

// Urutan baris tidak berubah.
export function filterBillingRows(
  rows: readonly BillingRow[],
  filters: BillingFilters,
) {
  const terms = billingSearchTerms(filters.query);
  return rows.filter((row) =>
    matches(
      row,
      filters,
      terms,
      terms.length > 0 ? billingSearchText(row) : "",
    ),
  );
}

export interface BillingFacetCounts {
  status: Record<BillingStatus, number>;
  match: Record<BillingMatch, number>;
  router: Record<string, number>;
  // Seluruh yang lolos semua saringan.
  total: number;
}

// Router yang ada di baris, urut nama, untuk pilihan saringan router.
export function billingRouters(rows: readonly BillingRow[]) {
  const names = new Map<string, string>();
  for (const row of rows) names.set(row.routerId, row.routerName);
  return [...names]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "id", { numeric: true }));
}

// Angka di samping tiap pilihan: berapa baris yang akan tampil bila pilihan itu
// dipilih, dengan saringan lain tetap berlaku. Memilih sebuah pilihan lalu
// selalu menghasilkan persis sebanyak angkanya.
export function billingFacetCounts(
  rows: readonly BillingRow[],
  filters: BillingFilters,
): BillingFacetCounts {
  const terms = billingSearchTerms(filters.query);
  const counts: BillingFacetCounts = {
    status: { lunas: 0, isolir: 0 },
    match: { exact: 0, normalized: 0, none: 0 },
    router: {},
    total: 0,
  };
  for (const { id } of billingRouters(rows)) counts.router[id] = 0;
  for (const row of rows) {
    const text = terms.length > 0 ? billingSearchText(row) : "";
    const check = (skip?: Dimension) =>
      matches(row, filters, terms, text, skip);
    if (check()) counts.total += 1;
    if (check("status")) counts.status[row.status] += 1;
    if (check("match")) counts.match[row.match] += 1;
    if (check("routerId")) counts.router[row.routerId] += 1;
  }
  return counts;
}
