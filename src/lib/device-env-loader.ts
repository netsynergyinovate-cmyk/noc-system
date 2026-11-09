// Pemuat konfigurasi perangkat dari environment variable. Murni: tidak
// mengimpor env.ts (yang parse + server-only) supaya mudah diuji. Nilai
// kosong/spasi dianggap belum diisi. Tidak pernah mengembalikan nilai rahasia
// di daftar `missing`, hanya NAMA variabelnya.

export type DeviceKind = "mikrotik" | "olt" | "genieacs" | "billing";
export type DeviceReadiness = "siap" | "belum_siap";

export type DeviceEnvStatus = {
  kind: DeviceKind;
  status: DeviceReadiness;
  /** Nama variabel env wajib yang belum diisi (kosong bila siap). */
  missing: string[];
};

// ponytail: GenieACS hanya mewajibkan URL (NBI boleh tanpa auth); tambah
// USER/PASSWORD di sini bila NBI produksi selalu memakai auth.
export const REQUIRED_ENV: Readonly<Record<DeviceKind, readonly string[]>> = {
  mikrotik: [
    "MIKROTIK_REST_HOST",
    "MIKROTIK_REST_USER",
    "MIKROTIK_REST_PASSWORD",
  ],
  olt: ["OLT_HSGQ_HOST", "OLT_HSGQ_USER", "OLT_HSGQ_PASSWORD"],
  genieacs: ["GENIEACS_NBI_URL"],
  billing: ["BILLING_URL", "BILLING_USERNAME", "BILLING_PASSWORD"],
};

export const DEVICE_KINDS = Object.keys(REQUIRED_ENV) as DeviceKind[];

type EnvSource = Readonly<Record<string, string | undefined>>;

export function evaluateDeviceEnv(
  kind: DeviceKind,
  source: EnvSource = process.env,
): DeviceEnvStatus {
  const missing = REQUIRED_ENV[kind].filter(
    (name) => (source[name] ?? "").trim() === "",
  );
  return { kind, status: missing.length ? "belum_siap" : "siap", missing };
}

export function loadDeviceEnvStatuses(
  source: EnvSource = process.env,
): Record<DeviceKind, DeviceEnvStatus> {
  return Object.fromEntries(
    DEVICE_KINDS.map((kind) => [kind, evaluateDeviceEnv(kind, source)]),
  ) as Record<DeviceKind, DeviceEnvStatus>;
}
