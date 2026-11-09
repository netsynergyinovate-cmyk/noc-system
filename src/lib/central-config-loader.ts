// Pure env loader: no server-only import so node --test can run it.
export type AppDataMode = "demo" | "live";
export type AppDeviceMode = "simulator" | "real";

export interface CentralConfig {
  database: {
    url: string | undefined;
    migrationUrl: string | undefined;
  };
  auth: {
    secret: string | undefined;
    url: string;
    realtimeTokenSecret: string | undefined;
    deviceSecret: string | undefined;
    trustedProxies: string | undefined;
  };
  modes: {
    dataMode: AppDataMode;
    defaultDeviceMode: AppDeviceMode;
  };
  devices: {
    mikrotik: {
      host: string | undefined;
      port: number;
      user: string | undefined;
      password: string | undefined;
      mode: AppDeviceMode;
    };
    olt: {
      host: string | undefined;
      port: number;
      user: string | undefined;
      password: string | undefined;
      mode: AppDeviceMode;
    };
    genieacs: {
      url: string | undefined;
      user: string | undefined;
      password: string | undefined;
      timeoutMs: number;
      mode: AppDeviceMode;
    };
    billing: {
      url: string | undefined;
      portalUrl: string | undefined;
      username: string | undefined;
      password: string | undefined;
      mode: AppDeviceMode;
    };
  };
  backendUrl: string;
}

export const REDACTED = "[REDACTED]";

// Same shape as CentralConfig; secrets/passwords hold "[REDACTED]" (or undefined if unset).
export type RedactedCentralConfig = CentralConfig;

export const MIN_AUTH_SECRET_LENGTH = 32;

type Source = Record<string, string | undefined>;

function str(source: Source, key: string): string | undefined {
  const value = source[key]?.trim();
  return value ? value : undefined;
}

function port(source: Source, key: string, fallback: number): number {
  const raw = str(source, key);
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  return n >= 1 && n <= 65535 ? n : fallback;
}

function positiveInt(source: Source, key: string, fallback: number): number {
  const raw = str(source, key);
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  return n >= 1 ? n : fallback;
}

function deviceMode(
  source: Source,
  key: string,
  fallback: AppDeviceMode,
): AppDeviceMode {
  const raw = str(source, key)?.toLowerCase();
  return raw === "simulator" || raw === "real" ? raw : fallback;
}

export function loadCentralConfig(source: Source = process.env): CentralConfig {
  const dataRaw = str(source, "DASHBOARD_DATA")?.toLowerCase();
  const defaultDeviceMode = deviceMode(source, "DEVICE_MODE", "simulator");

  return {
    database: {
      url: str(source, "DATABASE_URL"),
      migrationUrl: str(source, "MIGRATION_DATABASE_URL"),
    },
    auth: {
      secret: str(source, "BETTER_AUTH_SECRET"),
      url: str(source, "BETTER_AUTH_URL") ?? "http://localhost:3000",
      realtimeTokenSecret: str(source, "REALTIME_TOKEN_SECRET"),
      deviceSecret: str(source, "DEVICE_SECRET"),
      trustedProxies: str(source, "TRUSTED_PROXIES"),
    },
    modes: {
      dataMode: dataRaw === "live" ? "live" : "demo",
      defaultDeviceMode,
    },
    devices: {
      mikrotik: {
        host: str(source, "MIKROTIK_REST_HOST"),
        port: port(source, "MIKROTIK_REST_PORT", 443),
        user: str(source, "MIKROTIK_REST_USER"),
        password: str(source, "MIKROTIK_REST_PASSWORD"),
        mode: deviceMode(source, "MIKROTIK_MODE", defaultDeviceMode),
      },
      olt: {
        host: str(source, "OLT_HSGQ_HOST"),
        port: port(source, "OLT_HSGQ_PORT", 80),
        user: str(source, "OLT_HSGQ_USER"),
        password: str(source, "OLT_HSGQ_PASSWORD"),
        mode: deviceMode(source, "OLT_MODE", defaultDeviceMode),
      },
      genieacs: {
        url: str(source, "GENIEACS_NBI_URL"),
        user: str(source, "GENIEACS_NBI_USER"),
        password: str(source, "GENIEACS_NBI_PASSWORD"),
        timeoutMs: positiveInt(source, "GENIEACS_TIMEOUT_MS", 5000),
        mode: deviceMode(source, "GENIEACS_MODE", defaultDeviceMode),
      },
      billing: {
        url: str(source, "BILLING_URL"),
        portalUrl: str(source, "BILLING_PORTAL_URL"),
        username: str(source, "BILLING_USERNAME"),
        password: str(source, "BILLING_PASSWORD"),
        mode: deviceMode(source, "BILLING_MODE", defaultDeviceMode),
      },
    },
    backendUrl: str(source, "BACKEND_URL") ?? "http://localhost:8080",
  };
}

export interface CentralConfigValidation {
  valid: boolean;
  errors: string[];
  missingKeys: string[];
  isGoLiveReady: boolean;
}

export function validateCentralConfig(
  config: CentralConfig,
): CentralConfigValidation {
  const errors: string[] = [];
  const missingKeys: string[] = [];
  const missing = (key: string, message: string) => {
    missingKeys.push(key);
    errors.push(message);
  };

  if (!config.database.url)
    missing("DATABASE_URL", "DATABASE_URL wajib diisi.");

  if (!config.auth.secret)
    missing("BETTER_AUTH_SECRET", "BETTER_AUTH_SECRET wajib diisi.");
  else if (config.auth.secret.length < MIN_AUTH_SECRET_LENGTH)
    errors.push(
      `BETTER_AUTH_SECRET minimal ${MIN_AUTH_SECRET_LENGTH} karakter.`,
    );

  if (config.modes.dataMode === "live") {
    const mt = config.devices.mikrotik;
    if (!mt.host)
      missing(
        "MIKROTIK_REST_HOST",
        "Mode live: host router MikroTik wajib diisi.",
      );
    if (!mt.user)
      missing(
        "MIKROTIK_REST_USER",
        "Mode live: user router MikroTik wajib diisi.",
      );
    if (!mt.password)
      missing(
        "MIKROTIK_REST_PASSWORD",
        "Mode live: password router MikroTik wajib diisi.",
      );
    if (mt.mode === "simulator")
      errors.push("Mode live aktif namun router MikroTik masih mode simulator");
  }

  const valid = errors.length === 0;
  return {
    valid,
    errors,
    missingKeys,
    isGoLiveReady: valid && config.modes.dataMode === "live",
  };
}

function mask(value: string | undefined): string | undefined {
  return value === undefined ? undefined : REDACTED;
}

// Hide the password part of a connection string; keep user, host, db.
export function redactConnectionString(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    // Unparseable: mask anything between "user:" and "@".
    return value.replace(/:\/\/([^:/@\s]*):[^@\s]*@/, "://$1:***@");
  }
}

export function redactCentralConfig(
  config: CentralConfig,
): RedactedCentralConfig {
  const { devices } = config;
  return {
    database: {
      url: redactConnectionString(config.database.url),
      migrationUrl: redactConnectionString(config.database.migrationUrl),
    },
    auth: {
      ...config.auth,
      secret: mask(config.auth.secret),
      realtimeTokenSecret: mask(config.auth.realtimeTokenSecret),
      deviceSecret: mask(config.auth.deviceSecret),
    },
    modes: { ...config.modes },
    devices: {
      mikrotik: {
        ...devices.mikrotik,
        password: mask(devices.mikrotik.password),
      },
      olt: { ...devices.olt, password: mask(devices.olt.password) },
      genieacs: {
        ...devices.genieacs,
        password: mask(devices.genieacs.password),
      },
      billing: { ...devices.billing, password: mask(devices.billing.password) },
    },
    backendUrl: config.backendUrl,
  };
}
