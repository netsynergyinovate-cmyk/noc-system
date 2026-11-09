import {
  cloneThresholds,
  defaultThresholds,
  parseThresholds,
  sameThresholds,
  validateThresholds,
  type ThresholdErrors,
  type ThresholdValues,
} from "./thresholds";

// AMBANG ALERT YANG TERSIMPAN, untuk halaman Pengaturan > Ambang Batas. Sumbernya
// tabel `alert_thresholds` lewat /api/thresholds: GET untuk semua sesi login,
// PUT/DELETE butuh izin threshold:manage (server yang memeriksa). Rule engine Go
// membaca tabel itu saat backend dinyalakan (backend/cmd/server/main.go), jadi
// ambang baru berlaku setelah backend di-restart.
//
// Yang disimpan hanya angka ambang dan durasi. Tidak ada rahasia di sini.
//
// Bentuknya untuk useSyncExternalStore: `subscribe`, `getSnapshot` (objek yang
// SAMA selama isi dan status sama, jadi tidak ada render berlebih) dan
// `getServerSnapshot` (selalu bawaan dengan status "loading", supaya HTML server
// dan render pertama di browser sama; nilai dari server masuk sesudah dimuat).

export type ThresholdLoadStatus = "loading" | "ready" | "error";

export interface ThresholdSnapshot {
  values: ThresholdValues;
  status: ThresholdLoadStatus;
}

// Jawaban `data` dari server; dibaca ulang lewat parseThresholds, jadi isi yang
// aneh jatuh ke bawaan per aturan, tidak merobohkan halaman.
export interface ThresholdRemote {
  load(): Promise<unknown>;
  save(values: ThresholdValues): Promise<unknown>;
  reset(): Promise<unknown>;
}

export interface ThresholdRegistryOptions {
  remote?: ThresholdRemote;
  // Kapan nilai dimuat ulang (mis. tab kembali difokus, supaya simpanan dari
  // tab atau petugas lain ikut); mengembalikan fungsi untuk berhenti.
  listen?: (onChange: () => void) => () => void;
}

export type SaveResult =
  | { ok: true }
  // `errors` terisi bila nilai ditolak sebelum dikirim; kosong bila server
  // menolak atau tidak terjangkau (pesan ada di `message`).
  | { ok: false; errors: ThresholdErrors; message: string };

async function request(
  method: "GET" | "PUT" | "DELETE",
  body?: ThresholdValues,
) {
  let res: Response;
  try {
    res = await fetch("/api/thresholds", {
      method,
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(
      "Server tidak terjangkau. Ambang belum berubah; coba lagi.",
    );
  }
  const json = (await res.json().catch(() => null)) as {
    data?: unknown;
    error?: { message?: string };
  } | null;
  if (res.status === 403)
    throw new Error("Akun Anda tidak punya izin mengubah ambang batas.");
  if (!res.ok)
    throw new Error(
      json?.error?.message ??
        `Server gagal memproses ambang (HTTP ${res.status}).`,
    );
  return json?.data;
}

export const apiThresholdRemote: ThresholdRemote = {
  load: () => request("GET"),
  save: (values) => request("PUT", values),
  reset: () => request("DELETE"),
};

function defaultListen(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("focus", onChange);
  return () => window.removeEventListener("focus", onChange);
}

function freeze(snapshot: ThresholdSnapshot): ThresholdSnapshot {
  for (const rule of Object.values(snapshot.values)) Object.freeze(rule);
  Object.freeze(snapshot.values);
  return Object.freeze(snapshot);
}

const fromServer = (data: unknown) =>
  parseThresholds(JSON.stringify(data ?? null));

export function createThresholdRegistry({
  remote = apiThresholdRemote,
  listen = defaultListen,
}: ThresholdRegistryOptions = {}) {
  let snapshot = freeze({ values: defaultThresholds(), status: "loading" });
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  let stopListening: (() => void) | null = null;

  function emit() {
    for (const listener of [...listeners]) listener();
  }

  // Objek baru hanya bila isi atau status benar-benar berubah.
  function set(values: ThresholdValues, status: ThresholdLoadStatus) {
    const same = sameThresholds(values, snapshot.values);
    if (same && status === snapshot.status) return;
    snapshot = freeze({
      values: same ? snapshot.values : cloneThresholds(values),
      status,
    });
    emit();
  }

  // Satu permintaan sekaligus. Gagal sesudah pernah berhasil: nilai terakhir
  // tetap dipakai (status tetap "ready").
  function refresh(): Promise<void> {
    loading ??= remote
      .load()
      .then(
        (data) => set(fromServer(data), "ready"),
        () =>
          set(snapshot.values, snapshot.status === "ready" ? "ready" : "error"),
      )
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  async function write(op: () => Promise<unknown>): Promise<SaveResult> {
    try {
      set(fromServer(await op()), "ready");
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        errors: {},
        message:
          error instanceof Error ? error.message : "Gagal menyimpan ambang.",
      };
    }
  }

  // Nilai yang tidak lolos validasi ditolak seluruhnya tanpa dikirim.
  function save(values: ThresholdValues): Promise<SaveResult> {
    const errors = validateThresholds(values);
    if (Object.keys(errors).length > 0)
      return Promise.resolve({
        ok: false,
        errors,
        message: "Perbaiki isian yang salah.",
      });
    return write(() => remote.save(cloneThresholds(values)));
  }

  // Menghapus semua baris: setiap aturan kembali ke bawaan.
  function reset(): Promise<SaveResult> {
    return write(() => remote.reset());
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1) {
      stopListening = listen(() => void refresh());
      void refresh();
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        stopListening?.();
        stopListening = null;
      }
    };
  }

  const serverSnapshot = freeze({
    values: defaultThresholds(),
    status: "loading",
  });

  return {
    save,
    reset,
    refresh,
    subscribe,
    getSnapshot: () => snapshot,
    // Server dan render pertama di browser: selalu bawaan, sedang dimuat.
    getServerSnapshot: () => serverSnapshot,
  };
}

export type ThresholdRegistry = ReturnType<typeof createThresholdRegistry>;

// Satu registry untuk seluruh halaman. Tidak memanggil server sampai ada
// pelanggan, jadi aman diimpor di server.
export const thresholdRegistry = createThresholdRegistry();

export const saveThresholds = thresholdRegistry.save;
export const resetSavedThresholds = thresholdRegistry.reset;
export const subscribeThresholds = thresholdRegistry.subscribe;
export const getThresholdsSnapshot = thresholdRegistry.getSnapshot;
export const getThresholdsServerSnapshot = thresholdRegistry.getServerSnapshot;
