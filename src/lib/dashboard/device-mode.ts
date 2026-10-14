// Pengelola mode simulator lab vs perangkat fisik asli
// Menggunakan useSyncExternalStore agar reaktif di seluruh tab & komponen.

export type DeviceOperationMode = "simulator" | "real";

export interface DeviceModeState {
  mode: DeviceOperationMode;
  lastChangedAt: number;
}

const STORAGE_KEY = "noc_device_operation_mode";
const DEFAULT_STATE: DeviceModeState = {
  mode: "simulator",
  lastChangedAt: 1_760_000_000,
};

let currentState: DeviceModeState = DEFAULT_STATE;
let lastRaw: string | null = null;
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function getDeviceMode(): DeviceModeState {
  if (typeof window === "undefined") return currentState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // Objek lama dipertahankan bila teks sama: useSyncExternalStore butuh
    // snapshot yang stabil, kalau tidak render berulang tanpa henti.
    if (raw && raw !== lastRaw) {
      const parsed = JSON.parse(raw);
      if (parsed.mode === "simulator" || parsed.mode === "real") {
        lastRaw = raw;
        currentState = { mode: parsed.mode, lastChangedAt: Number(parsed.lastChangedAt) || 0 };
      }
    }
  } catch {
    // Abaikan jika storage diblokir
  }
  return currentState;
}

export function getDeviceModeServerSnapshot(): DeviceModeState {
  return DEFAULT_STATE;
}

export function subscribeDeviceMode(callback: () => void): () => void {
  listeners.add(callback);
  const handleStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      getDeviceMode();
      callback();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }
  return () => {
    listeners.delete(callback);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

export function setDeviceMode(mode: DeviceOperationMode): DeviceModeState {
  const nextState: DeviceModeState = {
    mode,
    lastChangedAt: Math.floor(Date.now() / 1000),
  };
  currentState = nextState;
  if (typeof window !== "undefined") {
    try {
      lastRaw = JSON.stringify(nextState);
      localStorage.setItem(STORAGE_KEY, lastRaw);
    } catch {
      // Abaikan jika storage gagal
    }
  }
  emitChange();
  return nextState;
}

export function getModeDescription(mode: DeviceOperationMode): {
  title: string;
  badge: string;
  description: string;
  warning?: string;
} {
  if (mode === "simulator") {
    return {
      title: "Mode Simulator Lab Lokal",
      badge: "Simulator Lab",
      description:
        "Aplikasi terhubung ke simulator perangkat di lingkungan Docker lokal. Aman untuk pengujian tanpa memengaruhi jaringan produksi.",
    };
  }
  return {
    title: "Mode Perangkat Fisik Nyata",
    badge: "Perangkat Fisik",
    description:
      "Aplikasi mengarahkan permintaan langsung ke Router MikroTik, OLT HSGQ, GenieACS, dan Billing di jaringan fisik server.",
    warning:
      "Pastikan rute VPN/gateway ke alamat IP fisik perangkat sudah terbuka dan kredensial diatur di environment variable.",
  };
}
