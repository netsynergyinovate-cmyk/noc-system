// Perangkat untuk halaman Setup Perangkat (data tiruan, tanpa impor lain
// supaya bisa dites langsung). Kontrak REST masa depan: POST /api/routers/test
// dan POST /api/routers (router), OLT menyusul.

export type DeviceKind = "router" | "olt" | "genieacs" | "billing";

export interface SetupDevice {
  id: string;
  kind: DeviceKind;
  name: string;
  host: string;
  status: "aktif" | "nonaktif";
  // Epoch detik; null = belum pernah lolos tes koneksi.
  lastSeenAt: number | null;
}

export interface DeviceInput {
  kind: DeviceKind;
  name: string;
  host: string;
  username: string;
  password: string;
}

// Tetap (bukan Date.now) supaya HTML server dan klien sama.
export const MOCK_SEEN_AT = 1_760_000_000;

export const mockSetupDevices: readonly SetupDevice[] = [
  {
    id: "d-r1",
    kind: "router",
    name: "RTR-Pusat-01",
    host: "10.10.0.1",
    status: "aktif",
    lastSeenAt: MOCK_SEEN_AT,
  },
  {
    id: "d-r2",
    kind: "router",
    name: "RTR-Barat-02",
    host: "10.10.0.2",
    status: "aktif",
    lastSeenAt: MOCK_SEEN_AT,
  },
  {
    id: "d-o1",
    kind: "olt",
    name: "OLT-Pusat-01",
    host: "10.10.1.1",
    status: "nonaktif",
    lastSeenAt: null,
  },
];

const HOST =
  /^(?:\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)$/i;

export type DeviceErrors = Partial<Record<keyof DeviceInput, string>>;

export function validateDevice(input: DeviceInput): DeviceErrors {
  const e: DeviceErrors = {};
  if (!input.name.trim()) e.name = "Nama wajib diisi.";
  const host = input.host.trim();
  if (!host) e.host = "Alamat host wajib diisi.";
  else if (
    !HOST.test(host) ||
    (/^\d+(\.\d+){3}$/.test(host) &&
      host.split(".").some((n) => Number(n) > 255))
  )
    e.host = "Alamat host tidak valid.";
  if (!input.username.trim()) e.username = "Username wajib diisi.";
  if (!input.password) e.password = "Password wajib diisi.";
  return e;
}

export type TestDiagnostics = {
  latencyMs: number;
  protocol: string;
  firmware?: string;
  cpuLoad?: number;
  uptime?: string;
};

export type TestResult =
  | { ok: true; diagnostics: TestDiagnostics }
  | { ok: false; reason: string; diagnostics: TestDiagnostics };

// Deterministik: host berakhiran ".0" tidak terjangkau, ".255" ditolak login.
export function mockTestConnection(input: DeviceInput): TestResult {
  const host = input.host.trim();
  const router = input.kind === "router";
  if (host.endsWith(".0"))
    return {
      ok: false,
      reason: "Host timeout setelah 3000ms",
      diagnostics: {
        latencyMs: 3000,
        protocol: router ? "REST API v7 (443)" : "OLT CLI (23)",
      },
    };
  if (host.endsWith(".255"))
    return {
      ok: false,
      reason: "HTTP 401 Unauthorized: Username/Password salah",
      diagnostics: {
        latencyMs: 18,
        protocol: router ? "REST API v7" : "OLT CLI",
      },
    };
  return {
    ok: true,
    diagnostics: {
      latencyMs: 14,
      protocol: router ? "MikroTik REST API v7" : "OLT SNMP/Telnet",
      firmware: router ? "RouterOS v7.14.3" : "ZTE C320 V2.1.0",
      cpuLoad: 9,
      uptime: "24h 12m",
    },
  };
}
