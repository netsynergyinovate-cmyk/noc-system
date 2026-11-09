// Validasi kunci variabel lingkungan wajib (Pengaman Deploy & Go-Live).
// Murni (pure): aman diuji dan digunakan pada runtime server/CLI.
// Dilarang membocorkan nilai kredensial/rahasia ke pesan error atau output laporan.

export interface EnvKeyDefinition {
  key: string;
  category: "database" | "auth" | "security" | "network" | "device";
  description: string;
  requiredInDemo: boolean;
  requiredInLive: boolean;
  minLength?: number;
  exactLength?: number;
  validator?: (val: string) => { valid: boolean; error?: string };
}

export interface EnvKeyStatus {
  key: string;
  category: "database" | "auth" | "security" | "network" | "device";
  required: boolean;
  present: boolean;
  valid: boolean;
  error?: string;
  warning?: string;
  description: string;
}

export interface RequiredEnvValidationResult {
  valid: boolean;
  mode: "demo" | "live";
  totalRequired: number;
  configuredRequired: number;
  missingRequired: string[];
  invalidRequired: string[];
  errors: string[];
  warnings: string[];
  keys: Record<string, EnvKeyStatus>;
  evaluatedAt: string;
}

const PLACEHOLDER_PATTERN =
  /<[^<>]+>|CHANGEME|TODO|your[_-]secret|your[_-]password/i;

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERN.test(value);
}

function isValidUrl(
  val: string,
  allowedProtocols = ["http:", "https:"],
): boolean {
  try {
    const parsed = new URL(val);
    return (
      allowedProtocols.includes(parsed.protocol) &&
      Boolean(parsed.hostname) &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

function isValidPostgresUrl(val: string): boolean {
  try {
    const parsed = new URL(val);
    return (
      ["postgres:", "postgresql:"].includes(parsed.protocol) &&
      Boolean(parsed.hostname) &&
      parsed.pathname.length > 1 &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

export const REQUIRED_ENV_DEFINITIONS: readonly EnvKeyDefinition[] = [
  {
    key: "DATABASE_URL",
    category: "database",
    description:
      "Koneksi basis data PostgreSQL untuk penyimpanan utama aplikasi",
    requiredInDemo: true,
    requiredInLive: true,
    validator: (val) => {
      if (!isValidPostgresUrl(val)) {
        return {
          valid: false,
          error: "Format DATABASE_URL harus URL PostgreSQL yang valid.",
        };
      }
      return { valid: true };
    },
  },
  {
    key: "BETTER_AUTH_SECRET",
    category: "auth",
    description:
      "Kunci enkripsi token sesi autentikasi pengguna (minimal 32 karakter)",
    requiredInDemo: true,
    requiredInLive: true,
    minLength: 32,
    validator: (val) => {
      if (val.length < 32) {
        return {
          valid: false,
          error: "BETTER_AUTH_SECRET wajib minimal 32 karakter acak.",
        };
      }
      if (isPlaceholder(val)) {
        return {
          valid: false,
          error: "BETTER_AUTH_SECRET masih berisi nilai placeholder template.",
        };
      }
      return { valid: true };
    },
  },
  {
    key: "BETTER_AUTH_URL",
    category: "auth",
    description:
      "Origin URL web aplikasi untuk validasi domain sesi (mis. http://localhost:3000)",
    requiredInDemo: true,
    requiredInLive: true,
    validator: (val) => {
      if (!isValidUrl(val)) {
        return {
          valid: false,
          error: "BETTER_AUTH_URL harus berupa URL origin HTTP/HTTPS valid.",
        };
      }
      return { valid: true };
    },
  },
  {
    key: "DEVICE_SECRET",
    category: "security",
    description:
      "Kunci AES-256 persis 32 karakter untuk enkripsi kredensial perangkat router/OLT",
    requiredInDemo: false,
    requiredInLive: true,
    exactLength: 32,
    validator: (val) => {
      if (val.length !== 32) {
        return {
          valid: false,
          error: "DEVICE_SECRET harus persis 32 karakter.",
        };
      }
      if (isPlaceholder(val)) {
        return {
          valid: false,
          error: "DEVICE_SECRET masih berupa placeholder template.",
        };
      }
      return { valid: true };
    },
  },
  {
    key: "REALTIME_TOKEN_SECRET",
    category: "security",
    description:
      "Kunci bersama backend Go untuk otentikasi tiket streaming WebSocket",
    requiredInDemo: false,
    requiredInLive: true,
    minLength: 32,
    validator: (val) => {
      if (val.length < 32) {
        return {
          valid: false,
          error: "REALTIME_TOKEN_SECRET wajib minimal 32 karakter acak.",
        };
      }
      if (isPlaceholder(val)) {
        return {
          valid: false,
          error: "REALTIME_TOKEN_SECRET masih berupa placeholder template.",
        };
      }
      return { valid: true };
    },
  },
  {
    key: "BACKEND_URL",
    category: "network",
    description:
      "Origin backend Go daemon untuk kolektor NetFlow, traffic history, dan WS hub",
    requiredInDemo: false,
    requiredInLive: true,
    validator: (val) => {
      if (!isValidUrl(val)) {
        return {
          valid: false,
          error: "BACKEND_URL harus berupa URL origin HTTP/HTTPS valid.",
        };
      }
      return { valid: true };
    },
  },
  {
    key: "MIKROTIK_REST_HOST",
    category: "device",
    description: "Alamat IP host router MikroTik RouterOS v7",
    requiredInDemo: false,
    requiredInLive: true,
    validator: (val) => {
      if (!val.trim()) {
        return {
          valid: false,
          error: "MIKROTIK_REST_HOST tidak boleh kosong di mode live.",
        };
      }
      return { valid: true };
    },
  },
  {
    key: "MIKROTIK_REST_USER",
    category: "device",
    description: "Username pengguna REST API router MikroTik",
    requiredInDemo: false,
    requiredInLive: true,
    validator: (val) => {
      if (!val.trim()) {
        return {
          valid: false,
          error: "MIKROTIK_REST_USER tidak boleh kosong di mode live.",
        };
      }
      return { valid: true };
    },
  },
  {
    key: "MIKROTIK_REST_PASSWORD",
    category: "device",
    description: "Kata sandi pengguna REST API router MikroTik",
    requiredInDemo: false,
    requiredInLive: true,
    validator: (val) => {
      if (!val.trim()) {
        return {
          valid: false,
          error: "MIKROTIK_REST_PASSWORD tidak boleh kosong di mode live.",
        };
      }
      if (isPlaceholder(val)) {
        return {
          valid: false,
          error: "MIKROTIK_REST_PASSWORD masih berupa placeholder.",
        };
      }
      return { valid: true };
    },
  },
];

type EnvSource = Record<string, string | undefined>;

export function validateRequiredEnv(
  source: EnvSource = process.env,
): RequiredEnvValidationResult {
  const v = (x: string | undefined) => x?.trim().toLowerCase();
  const isLive =
    ["live", "nyata"].includes(v(source.DASHBOARD_DATA) ?? "") ||
    ["live", "nyata"].includes(v(source.DATA_MODE) ?? "") ||
    v(source.NODE_ENV) === "production";

  const mode = isLive ? "live" : "demo";
  const keysResult: Record<string, EnvKeyStatus> = {};
  const missingRequired: string[] = [];
  const invalidRequired: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  let totalRequired = 0;
  let configuredRequired = 0;

  for (const def of REQUIRED_ENV_DEFINITIONS) {
    const isReq = mode === "live" ? def.requiredInLive : def.requiredInDemo;
    if (isReq) totalRequired++;

    const rawVal = source[def.key]?.trim();
    const present = Boolean(rawVal);

    let valid = true;
    let error: string | undefined;
    let warning: string | undefined;

    if (!present) {
      if (isReq) {
        valid = false;
        error = `${def.key} belum terisi pada variabel lingkungan.`;
        missingRequired.push(def.key);
        errors.push(error);
      } else {
        warning = `${def.key} belum diisi (opsional pada mode demo).`;
        warnings.push(warning);
      }
    } else {
      // Nilai ada, lakukan validasi format
      if (def.validator && rawVal) {
        const valRes = def.validator(rawVal);
        if (!valRes.valid) {
          valid = false;
          error = valRes.error;
          if (isReq) {
            invalidRequired.push(def.key);
            errors.push(`${def.key}: ${error}`);
          } else {
            warnings.push(`${def.key}: ${error}`);
          }
        }
      }

      if (isReq && valid) {
        configuredRequired++;
      }
    }

    keysResult[def.key] = {
      key: def.key,
      category: def.category,
      required: isReq,
      present,
      valid,
      error,
      warning,
      description: def.description,
    };
  }

  return {
    valid: errors.length === 0,
    mode,
    totalRequired,
    configuredRequired,
    missingRequired,
    invalidRequired,
    errors,
    warnings,
    keys: keysResult,
    evaluatedAt: new Date().toISOString(),
  };
}
