import {
  AUDIT_SYSTEM_ACTOR,
  auditActionList,
  auditActions,
  auditGroupLabels,
  auditOperators,
  describeChange,
  isAuditAction,
  type AuditAction,
  type AuditActionInfo,
  type AuditActor,
  type AuditEntry,
} from "./audit";

// PENCARIAN DAN SARINGAN JEJAK AKTIVITAS. Murni (tanpa React dan tanpa window),
// supaya bisa diuji tanpa layar: komponen hanya menyimpan pilihan saringannya,
// seperti resolved-filter.ts di riwayat alert.
//
// KONTRAK
//
//   query   Kata kunci bebas. Dipisah spasi; SEMUA kata harus ada di teks catatan
//           (urutan bebas, sepotong kata cukup). Teks catatan dan kueri
//           dinormalisasi dengan cara yang sama (normalize: NFC, huruf kecil,
//           spasi tunggal), jadi besar-kecil huruf, spasi ganda, tab, dan spasi
//           tak terputus tidak berpengaruh. Kueri yang hanya spasi tidak menyaring.
//   action  Satu aksi, atau "all". Harus sama persis.
//   actor   Id petugas (termasuk "system" untuk kejadian otomatis), atau "all".
//           Yang dipakai id, bukan nama, karena nama bisa berubah dan bisa kembar.
//           Id "all" dicadangkan untuk "semua petugas".
//   within  "all", "1h", "24h", atau "7d". Catatan masuk bila
//           `nowSec - durasi < at <= nowSec`: tegas sampai detik. Catatan tepat di
//           batas bawah sudah di luar, catatan tepat di `nowSec` masih di dalam,
//           dan catatan di masa depan (jam server mendahului) tidak pernah masuk.
//           `nowSec` yang diberikan komponen adalah AWAL MENIT sekarang
//           (useNowMinute), jadi catatan yang dibuat di menit berjalan baru ikut
//           saringan waktu setelah menit berganti (paling lama sekitar semenit).
//
// Teks yang dicari adalah apa yang dijelaskan sebuah baris: nama petugas, label
// aksi, label kelompok aksi, objek, ringkasan, dan tiap perubahan seperti yang
// tertulis (describeChange: nama bidang dan nilai dari/ke, atau "nilai
// disembunyikan"). Id catatan TIDAK dicari. Nilai rahasia tidak ada di data, jadi
// mencari kata sandi hanya menemukan NAMA bidangnya, tidak pernah nilainya.
//
// matches, filterAudit, dan auditFacetCounts memakai SATU pemeriksa (matchesWith),
// jadi mereka tidak bisa saling berbeda; tetap jaga ketiganya bila salah satunya
// diubah, dan jalankan e2e/audit-filter.spec.ts.

// "Waktu": semua yang ada di jendela, atau hanya yang baru.
export type AuditWithin = "all" | "1h" | "24h" | "7d";

export const auditWithinSeconds: Readonly<
  Record<Exclude<AuditWithin, "all">, number>
> = Object.freeze({
  "1h": 3_600,
  "24h": 86_400,
  "7d": 7 * 86_400,
});

// Urutan pilihan Waktu di layar, dan labelnya.
export const auditWithinList: readonly AuditWithin[] = Object.freeze([
  "all",
  "1h",
  "24h",
  "7d",
] as const);

export const auditWithinLabels: Readonly<
  Record<Exclude<AuditWithin, "all">, string>
> = Object.freeze({
  "1h": "1 jam terakhir",
  "24h": "24 jam terakhir",
  "7d": "7 hari terakhir",
});

export interface AuditFilter {
  query: string;
  action: AuditAction | "all";
  // "all" atau id petugas.
  actor: string;
  within: AuditWithin;
}

export const emptyAuditFilter: Readonly<AuditFilter> = Object.freeze({
  query: "",
  action: "all",
  actor: "all",
  within: "all",
});

// --- Teks ------------------------------------------------------------------

// Bentuk baku untuk dibandingkan: NFC (huruf beraksen yang ditulis terurai sama
// dengan yang utuh), huruf kecil, dan semua jenis spasi menjadi satu spasi tanpa
// spasi di tepi. Dipakai sama untuk isi baris dan kueri.
export function normalize(text: string) {
  return text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

// Kueri menjadi kata-kata baku; kosong bila tidak ada yang dicari.
export function searchTerms(query: string): string[] {
  const text = normalize(query);
  return text === "" ? [] : text.split(" ");
}

// Semua teks yang menjelaskan baris itu, sudah dinormalisasi. Label kelompok
// (Akses, Alert, Perangkat, Pengaturan) ikut supaya satu kata bisa menjaring
// seluruh kelompok aksi.
export function auditSearchableText(entry: AuditEntry) {
  // Aksi yang tidak dikenal (data dari luar yang salah) tidak punya label, dan
  // barisnya tetap bisa dicari lewat teks lainnya.
  const info = auditActions[entry.action] as AuditActionInfo | undefined;
  return normalize(
    [
      entry.actor.name,
      info?.label,
      info ? auditGroupLabels[info.group] : undefined,
      entry.target,
      entry.summary,
      ...entry.changes.map(describeChange),
    ]
      .filter((part): part is string => Boolean(part))
      .join(" "),
  );
}

// --- Saringan --------------------------------------------------------------

// Benar bila ada saringan yang bukan nilai kosongnya. Kueri yang hanya spasi
// (termasuk tab dan spasi tak terputus) tidak dihitung.
export function isFilterActive(filter: AuditFilter) {
  return (
    searchTerms(filter.query).length > 0 ||
    filter.action !== "all" ||
    filter.actor !== "all" ||
    filter.within !== "all"
  );
}

// Satu aturan jendela untuk saringan dan untuk hitungan di samping pilihan. Nilai
// Waktu yang bukan pilihan sah tidak punya durasi (undefined, atau bukan angka),
// jadi selisihnya NaN dan tidak ada catatan yang lolos: tidak pernah menyaring
// diam-diam menjadi "semua".
function inWindow(at: number, nowSec: number, seconds: number) {
  return at > nowSec - seconds && at <= nowSec;
}

type Dimension = "query" | "action" | "actor" | "within";

// Pemeriksa tunggal. `skip` mengabaikan satu saringan, untuk menghitung angka di
// samping pilihan saringan itu sendiri. `terms` dan `text` dihitung sekali oleh
// pemanggil (text hanya perlu bila ada kata kunci).
function matchesWith(
  entry: AuditEntry,
  filter: AuditFilter,
  terms: readonly string[],
  text: string,
  nowSec: number,
  skip?: Dimension,
) {
  if (
    skip !== "action" &&
    filter.action !== "all" &&
    entry.action !== filter.action
  )
    return false;
  if (
    skip !== "actor" &&
    filter.actor !== "all" &&
    entry.actor.id !== filter.actor
  )
    return false;
  if (
    skip !== "within" &&
    filter.within !== "all" &&
    !inWindow(entry.at, nowSec, auditWithinSeconds[filter.within])
  )
    return false;
  if (skip !== "query" && terms.length > 0) {
    if (!terms.every((term) => text.includes(term))) return false;
  }
  return true;
}

// Apakah satu catatan lolos semua saringan pada waktu `nowSec`.
export function matches(
  entry: AuditEntry,
  filter: AuditFilter,
  nowSec: number,
) {
  const terms = searchTerms(filter.query);
  return matchesWith(
    entry,
    filter,
    terms,
    terms.length > 0 ? auditSearchableText(entry) : "",
    nowSec,
  );
}

// Urutan masukan (terbaru di atas) tidak berubah. Bila tidak ada yang terbuang
// (saringan kosong, atau saringan yang kebetulan meloloskan semuanya), yang
// dikembalikan adalah ARRAY MASUKAN ITU SENDIRI, supaya memo dan render ulang di
// atasnya tidak bekerja sia-sia.
export function filterAudit(
  entries: readonly AuditEntry[],
  filter: AuditFilter,
  nowSec: number,
): readonly AuditEntry[] {
  const terms = searchTerms(filter.query);
  const kept = entries.filter((entry) =>
    matchesWith(
      entry,
      filter,
      terms,
      terms.length > 0 ? auditSearchableText(entry) : "",
      nowSec,
    ),
  );
  return kept.length === entries.length ? entries : kept;
}

// --- Pilihan petugas -------------------------------------------------------

// Petugas yang dikenal sistem (untuk menamai id di describeFilter bila daftar
// petugas dari data tidak diberikan).
const knownActors: readonly AuditActor[] = Object.freeze([
  ...auditOperators,
  AUDIT_SYSTEM_ACTOR,
]);

// Petugas unik yang ada di `entries`, urut nama (huruf kecil, urutan kode) dan
// "Sistem" paling akhir. Satu id yang tercatat dengan beberapa nama (petugas ganti
// nama) memakai nama dari catatan paling baru.
export function actorOptions(entries: readonly AuditEntry[]): AuditActor[] {
  const latest = new Map<string, { actor: AuditActor; at: number }>();
  for (const entry of entries) {
    const seen = latest.get(entry.actor.id);
    if (!seen || entry.at > seen.at) {
      latest.set(entry.actor.id, { actor: entry.actor, at: entry.at });
    }
  }
  const system = AUDIT_SYSTEM_ACTOR.id;
  return [...latest.values()]
    .map(({ actor }) => actor)
    .sort((a, b) => {
      if ((a.id === system) !== (b.id === system)) {
        return a.id === system ? 1 : -1;
      }
      const left = normalize(a.name);
      const right = normalize(b.name);
      if (left !== right) return left < right ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

// --- Angka di samping pilihan ----------------------------------------------

export interface AuditFacetCounts {
  // Satu angka per aksi, ditambah `all`.
  action: Record<AuditAction | "all", number>;
  // Satu angka per id petugas di data, ditambah `all`.
  actor: Record<string, number>;
  within: Record<AuditWithin, number>;
  // Seluruh yang lolos semua saringan.
  total: number;
}

// Pencacah tanpa prototipe, supaya id petugas seperti "__proto__" atau
// "constructor" hanyalah kunci biasa.
function counter(keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = Object.create(null);
  for (const key of keys) out[key] = 0;
  return out;
}

// Angka di samping tiap pilihan: berapa catatan yang akan tampil bila pilihan itu
// dipilih, dengan saringan di dimensi LAIN tetap berlaku (dimensi sendiri
// diabaikan). Memilih sebuah pilihan lalu selalu menghasilkan persis sebanyak
// angkanya; `all` pada tiap dimensi adalah hasil bila dimensi itu dikosongkan.
export function auditFacetCounts(
  entries: readonly AuditEntry[],
  filter: AuditFilter,
  nowSec: number,
): AuditFacetCounts {
  const terms = searchTerms(filter.query);
  const options = actorOptions(entries);
  const counts: AuditFacetCounts = {
    action: counter([...auditActionList, "all"]) as AuditFacetCounts["action"],
    actor: counter([...options.map((actor) => actor.id), "all"]),
    within: counter(auditWithinList) as AuditFacetCounts["within"],
    total: 0,
  };
  const windows = Object.keys(auditWithinSeconds) as Exclude<
    AuditWithin,
    "all"
  >[];
  for (const entry of entries) {
    const text = terms.length > 0 ? auditSearchableText(entry) : "";
    const check = (skip?: Dimension) =>
      matchesWith(entry, filter, terms, text, nowSec, skip);
    if (check()) counts.total += 1;
    if (check("action")) {
      counts.action.all += 1;
      counts.action[entry.action] += 1;
    }
    if (check("actor")) {
      counts.actor.all += 1;
      // "all" dicadangkan: petugas berid itu tidak dihitung dua kali.
      if (entry.actor.id !== "all") counts.actor[entry.actor.id] += 1;
    }
    if (check("within")) {
      counts.within.all += 1;
      for (const option of windows) {
        if (inWindow(entry.at, nowSec, auditWithinSeconds[option])) {
          counts.within[option] += 1;
        }
      }
    }
  }
  return counts;
}

// --- Kalimat ---------------------------------------------------------------

// Kata kunci yang panjang dipotong di kalimat (bukan di kolom isian), supaya
// pembaca layar dan pesan kosong tidak membacakan ribuan huruf.
export const AUDIT_QUERY_PREVIEW_MAX = 60;

// Kalimat ringkas tentang saringan yang aktif, untuk pembaca layar dan pesan
// kosong, mis. `kata "router", aksi "Router diubah", petugas "Andi Prasetyo",
// 24 jam terakhir`. `actors` menamai id petugas (bawaannya petugas yang dikenal
// sistem); id yang tidak dikenal ditulis apa adanya. Tanpa saringan: "tanpa
// saringan".
export function describeFilter(
  filter: AuditFilter,
  actors: readonly AuditActor[] = knownActors,
) {
  const parts: string[] = [];
  const words = filter.query.replace(/\s+/g, " ").trim();
  if (searchTerms(filter.query).length > 0) {
    // Dipotong per titik kode supaya emoji tidak terbelah.
    const letters = Array.from(words);
    const shown =
      letters.length > AUDIT_QUERY_PREVIEW_MAX
        ? `${letters.slice(0, AUDIT_QUERY_PREVIEW_MAX).join("")}…`
        : words;
    parts.push(`kata "${shown}"`);
  }
  if (filter.action !== "all") {
    parts.push(
      `aksi "${isAuditAction(filter.action) ? auditActions[filter.action].label : filter.action}"`,
    );
  }
  if (filter.actor !== "all") {
    const actor = actors.find((candidate) => candidate.id === filter.actor);
    parts.push(`petugas "${actor ? actor.name : filter.actor}"`);
  }
  if (filter.within !== "all") {
    parts.push(
      Object.prototype.hasOwnProperty.call(auditWithinLabels, filter.within)
        ? auditWithinLabels[filter.within]
        : String(filter.within),
    );
  }
  return parts.length > 0 ? parts.join(", ") : "tanpa saringan";
}
