// Simulator form konfigurasi & uji koneksi MikroTik untuk alur Onboarding Wajib.
// TIRUAN SEMENTARA: Wajib dialihkan ke backend nyata saat go-live (Fase 5 / 6). Murni.

import type { DataSourceEntry } from "./setup-extended.ts";

export interface OnboardingMikrotikInput {
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  useTls: boolean;
  mode: "simulator" | "real";
}

export interface OnboardingMikrotikTestResult {
  ok: boolean;
  latencyMs: number;
  testedAt: string;
  message: string;
  /** Kode galat (mis. TLS_ERROR, WRONG_PORT) saat gagal. */
  code?: string;
  details?: {
    version: string;
    boardName: string;
    cpuLoad: number;
    freeMemoryMb: number;
    totalMemoryMb: number;
    uptime: string;
  };
  errors?: string[];
}

export const ONBOARDING_MIKROTIK_MOCK_ENTRY: DataSourceEntry = {
  id: "onboarding-mikrotik-mock",
  module: "Form Konfigurasi & Uji MikroTik Onboarding",
  targetDevice: "Router MikroTik RouterOS v7 (REST API)",
  status: "dummy",
  readPath: "src/lib/dashboard/onboarding-mikrotik.ts",
  writePath: "POST /api/routers/test",
  envKey: "MIKROTIK_REST_HOST",
  notes:
    "Tiruan form konfigurasi & simulator uji koneksi MikroTik pada onboarding wajib; dialihkan ke REST API /api/routers saat go-live.",
};

export const DEFAULT_ONBOARDING_MIKROTIK: OnboardingMikrotikInput = {
  name: "Router Core Utama (MikroTik CCR2004)",
  host: "10.200.0.1",
  port: 443,
  username: "noc_operator",
  password: "",
  useTls: true,
  mode: "simulator",
};

/**
 * Pisahkan "host", "host:port", atau "http(s)://host[:port]" menjadi host dan
 * (bila ada) port dan skema. Dipakai form dan server agar membaca isian sama.
 */
export function splitHostInput(raw: string): {
  host: string;
  port?: number;
  useTls?: boolean;
} {
  const m = /^(?:(https?):\/\/)?(\[[^\]]+\]|[^:/\s]+)(?::(\d{1,5}))?\/?$/i.exec(
    raw.trim(),
  );
  if (!m) return { host: raw.trim() };
  const port = m[3] ? Number(m[3]) : undefined;
  // Port di luar 1-65535 jangan dibuang diam-diam: biarkan isian utuh agar validasi menolaknya.
  if (port !== undefined && (port < 1 || port > 65535))
    return { host: raw.trim() };
  return {
    host: m[2],
    ...(port !== undefined && { port }),
    ...(m[1] && { useTls: m[1].toLowerCase() === "https" }),
  };
}

/** Port bawaan layanan REST bila kolom port dikosongkan: www-ssl 443, www 80. */
export const defaultRestPort = (useTls: boolean): number => (useTls ? 443 : 80);

/**
 * Validasi isian form konfigurasi router MikroTik.
 */
export function validateOnboardingMikrotikInput(
  input: OnboardingMikrotikInput,
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  if (!input.name.trim()) {
    errors.name = "Nama router wajib diisi.";
  }
  const rawHost = input.host.trim();
  if (!rawHost) {
    errors.host = "IP host atau domain router wajib diisi.";
  } else if (
    /[!@#$%^&*()+=<>[\]{}|\\~`"',?]/g.test(rawHost) ||
    /\s/.test(rawHost)
  ) {
    errors.host = "Host memuat karakter tidak valid.";
  }

  if (input.port < 1 || input.port > 65535) {
    errors.port = "Port REST API harus berada di antara 1 dan 65535.";
  }

  if (!input.username.trim()) {
    errors.username = "Username REST API wajib diisi.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Simulator uji koneksi MikroTik REST API.
 * Menghasilkan latensi realistis dan data resource perangkat tiruan.
 */
export function simulateOnboardingMikrotikTest(
  input: OnboardingMikrotikInput,
): OnboardingMikrotikTestResult {
  const validation = validateOnboardingMikrotikInput(input);
  if (!validation.valid) {
    return {
      ok: false,
      latencyMs: 0,
      testedAt: new Date().toISOString(),
      message: "Konfigurasi tidak lengkap atau tidak valid.",
      errors: Object.values(validation.errors),
    };
  }

  // Simulator kegagalan bila host mengindikasikan down / offline
  if (input.host.includes("offline") || input.host.includes("error")) {
    return {
      ok: false,
      latencyMs: 320,
      testedAt: new Date().toISOString(),
      message: `Gagal terhubung ke host ${input.host}:${input.port} (Connection Refused / Timeout).`,
      errors: [
        "Pastikan REST API aktif di /ip/service dan port terbuka di firewall.",
      ],
    };
  }

  // Sukses uji koneksi simulator
  const randomLatency = Math.floor(Math.random() * 8) + 12; // 12-19ms
  return {
    ok: true,
    latencyMs: randomLatency,
    testedAt: new Date().toISOString(),
    message: `Koneksi berhasil ke RouterOS v7 pada ${input.host}:${input.port} (TLS: ${input.useTls ? "Aktif" : "Non-aktif"}).`,
    details: {
      version: "RouterOS v7.16.1 (stable)",
      boardName: "CCR2004-16G-2S+",
      cpuLoad: 14,
      freeMemoryMb: 3584,
      totalMemoryMb: 4096,
      uptime: "21d 08h 42m 15s",
    },
  };
}
