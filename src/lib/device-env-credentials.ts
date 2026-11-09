// Pembaca kredensial perangkat dari environment. Murni (tanpa "server-only")
// agar bisa diuji dengan node --test. Hasil berisi kata sandi ASLI: hanya untuk
// server; pakai redactDeviceCredentials sebelum dicatat/ditampilkan.

export type DeviceEnvType = "mikrotik" | "olt" | "genieacs" | "billing";
export type DeviceOperationMode = "simulator" | "real";

export interface DeviceEnvCredentials {
  type: DeviceEnvType;
  host: string;
  port: number;
  username: string;
  password?: string;
  mode: DeviceOperationMode;
  useTls?: boolean;
  extra?: Record<string, string | number | boolean | undefined>;
}

type Source = Record<string, string | undefined>;

const clean = (v: string | undefined): string => (v ?? "").trim();

function readPort(v: string | undefined, fallback: number): number {
  const n = Number(clean(v));
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : fallback;
}

// Nilai mode tak dikenal diabaikan (jatuh ke kandidat berikutnya).
function readMode(
  source: Source,
  specific: string,
  hostKey: string,
): DeviceOperationMode {
  for (const key of [specific, "DEVICE_MODE"]) {
    const v = clean(source[key]).toLowerCase();
    if (v === "real" || v === "simulator") return v;
  }
  return clean(source[hostKey]) ? "real" : "simulator";
}

export function readMikrotikEnv(
  source: Source = process.env,
): DeviceEnvCredentials {
  const port = readPort(source.MIKROTIK_REST_PORT, 443);
  return {
    type: "mikrotik",
    host: clean(source.MIKROTIK_REST_HOST) || "127.0.0.1",
    port,
    username: clean(source.MIKROTIK_REST_USER) || "admin",
    password: source.MIKROTIK_REST_PASSWORD || undefined,
    mode: readMode(source, "MIKROTIK_MODE", "MIKROTIK_REST_HOST"),
    useTls: port === 443 || port === 8443,
  };
}

export function readOltEnv(source: Source = process.env): DeviceEnvCredentials {
  return {
    type: "olt",
    host: clean(source.OLT_HSGQ_HOST) || "127.0.0.1",
    port: readPort(source.OLT_HSGQ_PORT, 80),
    username: clean(source.OLT_HSGQ_USER) || "admin",
    password: source.OLT_HSGQ_PASSWORD || undefined,
    mode: readMode(source, "OLT_MODE", "OLT_HSGQ_HOST"),
  };
}

export function readGenieacsEnv(
  source: Source = process.env,
): DeviceEnvCredentials {
  const host = clean(source.GENIEACS_NBI_URL) || "http://localhost:7557";
  return {
    type: "genieacs",
    host,
    port: readPort(undefined, 7557),
    username: clean(source.GENIEACS_NBI_USER),
    password: source.GENIEACS_NBI_PASSWORD || undefined,
    mode: readMode(source, "GENIEACS_MODE", "GENIEACS_NBI_URL"),
    useTls: /^https:/i.test(host),
    extra: { timeoutMs: Number(source.GENIEACS_TIMEOUT_MS) || 5000 },
  };
}

export function readBillingEnv(
  source: Source = process.env,
): DeviceEnvCredentials {
  const host = clean(source.BILLING_URL) || "http://localhost:8080";
  return {
    type: "billing",
    host,
    port: readPort(undefined, 8080),
    username: clean(source.BILLING_USERNAME) || "billing-admin",
    password: source.BILLING_PASSWORD || undefined,
    mode: readMode(source, "BILLING_MODE", "BILLING_URL"),
    useTls: /^https:/i.test(host),
    extra: { portalUrl: clean(source.BILLING_PORTAL_URL) || undefined },
  };
}

export function readAllDeviceEnv(
  source: Source = process.env,
): Record<DeviceEnvType, DeviceEnvCredentials> {
  return {
    mikrotik: readMikrotikEnv(source),
    olt: readOltEnv(source),
    genieacs: readGenieacsEnv(source),
    billing: readBillingEnv(source),
  };
}

// True hanya bila env wajib diisi eksplisit (default tidak dihitung).
export function hasConfiguredEnvDevice(
  type: DeviceEnvType,
  source: Source = process.env,
): boolean {
  const set = (k: string) => clean(source[k]) !== "";
  switch (type) {
    case "mikrotik":
      return (
        set("MIKROTIK_REST_HOST") &&
        set("MIKROTIK_REST_USER") &&
        set("MIKROTIK_REST_PASSWORD")
      );
    case "olt":
      return (
        set("OLT_HSGQ_HOST") && set("OLT_HSGQ_USER") && set("OLT_HSGQ_PASSWORD")
      );
    case "genieacs":
      return set("GENIEACS_NBI_URL");
    case "billing":
      return (
        set("BILLING_URL") && set("BILLING_USERNAME") && set("BILLING_PASSWORD")
      );
  }
}

export function redactDeviceCredentials(
  creds: DeviceEnvCredentials,
): DeviceEnvCredentials {
  return { ...creds, password: "[REDACTED]" };
}
