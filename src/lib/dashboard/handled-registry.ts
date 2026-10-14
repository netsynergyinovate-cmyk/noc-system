// CATATAN ALERT YANG DITANDAI DITANGANI. Petugas menandai alert aktif sudah
// ditangani (halaman Alert); alert itu lalu pindah ke riwayat alert selesai.
// Catatan siapa dan kapan inilah yang disimpan di sini.
//
// Pada fase frontend, bagian ini adalah "database" tiruan milik server palsu
// (alert-actions.ts): hub tiruan, pemuat REST tiruan, dan daftar anomali sama-sama
// membacanya, jadi semua halaman sepakat alert mana yang sudah ditangani, seperti
// pada backend sungguhan di mana semuanya membaca baris network_logs yang sama.
// Disimpan di localStorage supaya alert yang sudah ditandai tidak "hidup lagi"
// ketika halaman dimuat ulang; bila penyimpanan diblokir, catatan hanya berlaku di
// sesi ini. Backend sungguhan menggantinya dengan kolom handled_at dan handled_by
// (lihat "Menandai alert ditangani" di backend/README.md).

export interface HandledRecord {
  // Id alert yang ditandai.
  id: string;
  // Detik epoch BULAT: kapan petugas mengonfirmasi (jam server).
  at: number;
  // Nama petugas yang menandai, dari sesi login.
  by: string;
}

export type HandledMap = ReadonlyMap<string, HandledRecord>;

// Tidak ada alert yang ditandai; nilai awal semua fungsi data tiruan.
export const noHandled: HandledMap = new Map();

const STORAGE_KEY = "alertHandled";

// Catatan disimpan sejauh riwayat alert (7 hari): lebih tua dari itu alertnya
// sudah keluar dari riwayat, jadi catatannya tidak berguna lagi.
export const HANDLED_RETENTION_SECONDS = 7 * 24 * 3600;

function isRecord(value: unknown): value is HandledRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id !== "" &&
    typeof record.at === "number" &&
    Number.isSafeInteger(record.at) &&
    record.at > 0 &&
    typeof record.by === "string" &&
    record.by.trim() !== ""
  );
}

// Membaca isi penyimpanan. Isi yang rusak atau diubah tangan tidak boleh
// merobohkan halaman: yang tidak sah dibuang satu per satu, sisanya dipakai.
export function parseHandled(raw: string | null | undefined) {
  const map = new Map<string, HandledRecord>();
  if (!raw) return map;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return map;
  }
  if (!Array.isArray(data)) return map;
  for (const item of data) {
    if (isRecord(item))
      map.set(item.id, { id: item.id, at: item.at, by: item.by });
  }
  return map;
}

export function serializeHandled(map: HandledMap) {
  return JSON.stringify(
    [...map.values()].map(({ id, at, by }) => ({ id, at, by })),
  );
}

// Membuang catatan yang sudah lewat masa simpannya. Bila tidak ada yang dibuang,
// peta yang sama dikembalikan.
export function pruneHandled(
  map: HandledMap,
  nowSec: number,
  retentionSeconds = HANDLED_RETENTION_SECONDS,
): HandledMap {
  const cutoff = nowSec - retentionSeconds;
  let expired = false;
  for (const record of map.values()) {
    if (record.at <= cutoff) {
      expired = true;
      break;
    }
  }
  if (!expired) return map;
  return new Map([...map].filter(([, record]) => record.at > cutoff));
}

export interface HandledRegistryOptions {
  storage?: () => Pick<Storage, "getItem" | "setItem"> | null;
  now?: () => number;
}

function defaultStorage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function createHandledRegistry({
  storage = defaultStorage,
  now = () => Math.floor(Date.now() / 1000),
}: HandledRegistryOptions = {}) {
  // Isi terakhir yang dibaca dari penyimpanan, dan petanya. Dibaca ulang hanya bila
  // teksnya berubah (mis. tab lain menandai alert), jadi memanggil `all` tiap detik
  // murah.
  let lastRaw: string | null | undefined;
  let records: HandledMap = noHandled;
  // Penyimpanan tidak bisa dipakai (diblokir atau penuh): catatan di memori saja.
  let memoryOnly = false;

  // Seluruh catatan yang berlaku. Objek yang sama dikembalikan sampai isinya
  // berubah.
  function all(): HandledMap {
    if (memoryOnly) return records;
    let raw: string | null;
    try {
      const store = storage();
      if (store === null) {
        memoryOnly = true;
        return records;
      }
      raw = store.getItem(STORAGE_KEY);
    } catch {
      memoryOnly = true;
      return records;
    }
    if (raw !== lastRaw) {
      lastRaw = raw;
      records = pruneHandled(parseHandled(raw), now());
    }
    return records;
  }

  // Mencatat satu alert sebagai ditangani. Catatan lama untuk id yang sama
  // diganti.
  function add(record: HandledRecord) {
    const next = new Map(all());
    next.set(record.id, record);
    records = pruneHandled(next, now());
    if (memoryOnly) return;
    try {
      const store = storage();
      if (store === null) throw new Error("tidak ada penyimpanan");
      store.setItem(STORAGE_KEY, serializeHandled(records));
    } catch {
      memoryOnly = true;
    }
  }

  return { all, add };
}

export type HandledRegistry = ReturnType<typeof createHandledRegistry>;

// Satu catatan untuk seluruh halaman.
export const handledRegistry = createHandledRegistry();

// Catatan yang berlaku sekarang; kosong di luar browser.
export const currentHandled = () => handledRegistry.all();
