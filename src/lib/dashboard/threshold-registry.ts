import {
  cloneThresholds,
  defaultThresholds,
  parseThresholds,
  sameThresholds,
  serializeThresholds,
  validateThresholds,
  type ThresholdErrors,
  type ThresholdValues,
} from "./thresholds";

// AMBANG ALERT YANG TERSIMPAN. Pada fase frontend, bagian ini adalah "database"
// tiruan untuk halaman Pengaturan > Ambang Batas, dengan pola yang sama seperti
// handled-registry.ts: disimpan di localStorage supaya nilai bertahan setelah
// halaman dimuat ulang dan ikut berubah di tab lain; bila penyimpanan diblokir
// atau penuh, nilai hanya berlaku di sesi ini dan halaman tidak boleh roboh.
//
// Yang disimpan hanya angka ambang dan durasi. Tidak ada rahasia di sini.
//
// PENTING (kejujuran): rule engine di backend BELUM membaca nilai ini, dan daftar
// anomali serta alert tiruan di dashboard tetap memakai `anomalyRules`. Backend
// sungguhan menggantinya dengan tabel pengaturan yang dibaca rule engine.
//
// Bentuknya untuk useSyncExternalStore: `subscribe`, `getSnapshot` (objek yang
// SAMA selama isinya sama, jadi tidak ada render berlebih) dan
// `getServerSnapshot` (selalu nilai bawaan, supaya HTML server dan render
// pertama di browser sama; nilai tersimpan masuk sesudah hidrasi).

export const THRESHOLDS_STORAGE_KEY = "alertThresholds";

export type ThresholdStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

export interface ThresholdRegistryOptions {
  storage?: () => ThresholdStorage | null;
  // Mendengarkan perubahan dari tab lain; mengembalikan fungsi untuk berhenti.
  listen?: (onChange: () => void) => () => void;
}

export type SaveResult =
  | {
      ok: true;
      // Benar bila nilai benar-benar tertulis di penyimpanan peramban; salah
      // bila hanya berlaku di sesi ini karena penyimpanan tidak bisa dipakai.
      persisted: boolean;
    }
  | { ok: false; errors: ThresholdErrors };

function defaultStorage(): ThresholdStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

// Event `storage` hanya datang dari tab LAIN; perubahan di tab ini diberi tahu
// langsung oleh registry.
function defaultListen(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = (event: StorageEvent) => {
    if (event.key === null || event.key === THRESHOLDS_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

function freeze(values: ThresholdValues): ThresholdValues {
  for (const rule of Object.values(values)) Object.freeze(rule);
  return Object.freeze(values);
}

export function createThresholdRegistry({
  storage = defaultStorage,
  listen = defaultListen,
}: ThresholdRegistryOptions = {}) {
  // Nilai yang berlaku sekarang. Objek yang sama dikembalikan sampai ISINYA
  // berubah, bukan sampai teksnya berubah.
  let current: ThresholdValues = freeze(defaultThresholds());
  // Teks terakhir yang dibaca dari penyimpanan; undefined = belum pernah dibaca.
  let lastRaw: string | null | undefined;
  // Penyimpanan tidak bisa dipakai (diblokir atau penuh): nilai di memori saja.
  let memoryOnly = false;
  const listeners = new Set<() => void>();
  let stopListening: (() => void) | null = null;

  function emit() {
    for (const listener of [...listeners]) listener();
  }

  // Nilai tersimpan. Isi yang rusak tidak melempar galat (lihat parseThresholds).
  function getSnapshot(): ThresholdValues {
    if (memoryOnly) return current;
    let raw: string | null;
    try {
      const store = storage();
      if (store === null) {
        memoryOnly = true;
        return current;
      }
      raw = store.getItem(THRESHOLDS_STORAGE_KEY);
    } catch {
      memoryOnly = true;
      return current;
    }
    if (raw !== lastRaw) {
      lastRaw = raw;
      const next = parseThresholds(raw);
      if (!sameThresholds(next, current)) current = freeze(next);
    }
    return current;
  }

  // Menetapkan nilai baru; `raw` null berarti menghapus kuncinya (kembali ke
  // bawaan).
  function commit(next: ThresholdValues, raw: string | null): SaveResult {
    if (!sameThresholds(next, current)) current = freeze(cloneThresholds(next));
    let persisted = false;
    if (!memoryOnly) {
      try {
        const store = storage();
        if (store === null) throw new Error("tidak ada penyimpanan");
        if (raw === null) store.removeItem(THRESHOLDS_STORAGE_KEY);
        else store.setItem(THRESHOLDS_STORAGE_KEY, raw);
        lastRaw = raw;
        persisted = true;
      } catch {
        memoryOnly = true;
      }
    }
    emit();
    return { ok: true, persisted };
  }

  // Menyimpan nilai. Nilai yang tidak lolos validasi ditolak seluruhnya dan tidak
  // ada yang berubah.
  function save(values: ThresholdValues): SaveResult {
    const errors = validateThresholds(values);
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    const next = cloneThresholds(values);
    return commit(next, serializeThresholds(next));
  }

  // Mengembalikan semua aturan ke nilai bawaan dan menghapus yang tersimpan.
  function reset(): SaveResult {
    return commit(defaultThresholds(), null);
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) stopListening = listen(emit);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        stopListening?.();
        stopListening = null;
      }
    };
  }

  const serverSnapshot = freeze(defaultThresholds());

  return {
    getSaved: getSnapshot,
    save,
    reset,
    subscribe,
    getSnapshot,
    // Server dan render pertama di browser: selalu nilai bawaan.
    getServerSnapshot: () => serverSnapshot,
  };
}

export type ThresholdRegistry = ReturnType<typeof createThresholdRegistry>;

// Satu registry untuk seluruh halaman. Tidak menyentuh penyimpanan sampai
// dibutuhkan, jadi aman diimpor di server.
export const thresholdRegistry = createThresholdRegistry();

export const getSavedThresholds = thresholdRegistry.getSaved;
export const saveThresholds = thresholdRegistry.save;
export const resetSavedThresholds = thresholdRegistry.reset;
export const subscribeThresholds = thresholdRegistry.subscribe;
export const getThresholdsSnapshot = thresholdRegistry.getSnapshot;
export const getThresholdsServerSnapshot = thresholdRegistry.getServerSnapshot;
