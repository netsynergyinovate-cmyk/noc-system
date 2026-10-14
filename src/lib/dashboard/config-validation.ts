// Validasi konfigurasi lingkungan (Fase 1, tiruan sementara → wajib dihapus
// saat go-live, Fase 5). Fungsi murni: tidak membaca process.env sendiri dan
// TIDAK PERNAH memuat nilai env ke hasil (hanya nama variabel).

export type ValidationSeverity = "fatal" | "warning" | "info";

export interface ConfigValidationItem {
  id: string;
  category:
    | "database"
    | "auth"
    | "router"
    | "optional_devices"
    | "data_mode";
  envKey: string;
  label: string;
  severity: ValidationSeverity;
  status: "valid" | "missing" | "invalid";
  message: string;
  remediation: string;
}

export interface ConfigValidationResult {
  ok: boolean;
  fatalCount: number;
  warningCount: number;
  validCount: number;
  totalCount: number;
  items: ConfigValidationItem[];
  summaryNotice: string;
}

export type ConfigDataMode = "dummy" | "nyata";
export type ConfigSource = Record<string, string | undefined>;

export const CATEGORY_LABELS: Record<ConfigValidationItem["category"], string> =
  {
    database: "Database",
    auth: "Autentikasi",
    router: "Router MikroTik (wajib)",
    optional_devices: "Perangkat opsional",
    data_mode: "Mode data & pengaman go-live",
  };

export const MIN_AUTH_SECRET_LENGTH = 32;
export const GO_LIVE_REJECTION =
  "Penolakan saat start: Mode nyata aktif namun konfigurasi belum lengkap";

interface Rule {
  category: ConfigValidationItem["category"];
  envKey: string;
  label: string;
  failSeverity: ValidationSeverity;
  minLength?: number;
  hint: string;
}

const RULES: readonly Rule[] = [
  {
    category: "database",
    envKey: "DATABASE_URL",
    label: "Koneksi database",
    failSeverity: "fatal",
    hint: "Isi dengan alamat PostgreSQL, mis. postgres://user:sandi@host:5432/nama.",
  },
  {
    category: "auth",
    envKey: "BETTER_AUTH_SECRET",
    label: "Kunci rahasia autentikasi",
    failSeverity: "fatal",
    minLength: MIN_AUTH_SECRET_LENGTH,
    hint: `Isi acak minimal ${MIN_AUTH_SECRET_LENGTH} karakter, mis. dari npm run setup.`,
  },
  {
    category: "auth",
    envKey: "BETTER_AUTH_URL",
    label: "URL aplikasi (autentikasi)",
    failSeverity: "fatal",
    hint: "Isi dengan alamat aplikasi, lengkap dengan port, mis. http://localhost:3000.",
  },
  {
    category: "router",
    envKey: "MIKROTIK_REST_HOST",
    label: "Host REST MikroTik",
    failSeverity: "fatal",
    hint: "Isi alamat IP atau nama host router.",
  },
  {
    category: "router",
    envKey: "MIKROTIK_REST_USER",
    label: "Username REST MikroTik",
    failSeverity: "fatal",
    hint: "Isi akun read-only khusus NOC pada router.",
  },
  {
    category: "router",
    envKey: "MIKROTIK_REST_PASSWORD",
    label: "Password REST MikroTik",
    failSeverity: "fatal",
    hint: "Isi password akun router tersebut.",
  },
  {
    category: "optional_devices",
    envKey: "OLT_HSGQ_HOST",
    label: "Host OLT HSGQ",
    failSeverity: "warning",
    hint: "Isi alamat OLT bila ingin memantau sinyal optik.",
  },
  {
    category: "optional_devices",
    envKey: "GENIEACS_NBI_URL",
    label: "URL NBI GenieACS",
    failSeverity: "warning",
    hint: "Isi URL NBI GenieACS bila ingin memantau CPE/ONT.",
  },
  {
    category: "optional_devices",
    envKey: "BILLING_URL",
    label: "URL sistem billing",
    failSeverity: "warning",
    hint: "Isi URL billing bila ingin sinkron status Lunas/Isolir.",
  },
];

function checkRule(rule: Rule, raw: string | undefined): ConfigValidationItem {
  const value = (raw ?? "").trim();
  const base = {
    id: rule.envKey.toLowerCase().replaceAll("_", "-"),
    category: rule.category,
    envKey: rule.envKey,
    label: rule.label,
  };
  if (value === "")
    return {
      ...base,
      severity: rule.failSeverity,
      status: "missing",
      message: `${rule.envKey} belum diisi.`,
      remediation: rule.hint,
    };
  if (rule.minLength && value.length < rule.minLength)
    return {
      ...base,
      severity: rule.failSeverity,
      status: "invalid",
      message: `${rule.envKey} terlalu pendek (minimal ${rule.minLength} karakter).`,
      remediation: rule.hint,
    };
  return {
    ...base,
    severity: "info",
    status: "valid",
    message: `${rule.envKey} terisi.`,
    remediation: "Tidak ada tindakan.",
  };
}

export function evaluateConfigValidation(
  source: ConfigSource = {},
  dataMode: ConfigDataMode = "dummy",
): ConfigValidationResult {
  const items = RULES.map((rule) => checkRule(rule, source[rule.envKey]));
  const incomplete = items.some((i) => i.status !== "valid");

  if (dataMode === "nyata" && incomplete) {
    items.push({
      id: "dashboard-data",
      category: "data_mode",
      envKey: "DASHBOARD_DATA",
      label: "Mode data",
      severity: "fatal",
      status: "invalid",
      message: GO_LIVE_REJECTION,
      remediation:
        "Lengkapi semua variabel di atas, atau kembalikan DASHBOARD_DATA ke demo.",
    });
  } else {
    items.push({
      id: "dashboard-data",
      category: "data_mode",
      envKey: "DASHBOARD_DATA",
      label: "Mode data",
      severity: "info",
      status: "valid",
      message:
        dataMode === "nyata"
          ? "Mode nyata aktif dan konfigurasi lengkap."
          : "Mode demo: data tiruan, tidak ada pemeriksaan go-live.",
      remediation: "Tidak ada tindakan.",
    });
  }

  const fatalCount = items.filter((i) => i.severity === "fatal").length;
  const warningCount = items.filter((i) => i.severity === "warning").length;
  const validCount = items.filter((i) => i.status === "valid").length;
  const summaryNotice =
    fatalCount > 0
      ? `${fatalCount} galat fatal harus diperbaiki sebelum aplikasi bisa dipakai.`
      : warningCount > 0
        ? `Tidak ada galat fatal; ${warningCount} perangkat opsional belum dikonfigurasi.`
        : "Semua konfigurasi valid.";

  return {
    ok: fatalCount === 0,
    fatalCount,
    warningCount,
    validCount,
    totalCount: items.length,
    items,
    summaryNotice,
  };
}

// --- Skenario tiruan (sementara, Fase 1) -----------------------------------
// Nilai di bawah hanya contoh palsu; bukan kredensial sungguhan.
export interface MockConfigScenario {
  id: string;
  label: string;
  description: string;
  dataMode: ConfigDataMode;
  env: ConfigSource;
}

const FULL_ENV: ConfigSource = {
  DATABASE_URL: "postgres://contoh:contoh@localhost:5432/contoh",
  BETTER_AUTH_SECRET: "contoh-tiruan-tidak-rahasia-0123456789",
  BETTER_AUTH_URL: "http://localhost:3000",
  MIKROTIK_REST_HOST: "192.0.2.1",
  MIKROTIK_REST_USER: "noc-readonly",
  MIKROTIK_REST_PASSWORD: "contoh-tiruan",
  OLT_HSGQ_HOST: "192.0.2.10",
  GENIEACS_NBI_URL: "http://192.0.2.20:7557",
  BILLING_URL: "https://billing.example.test",
};

function without(...keys: string[]): ConfigSource {
  const copy: ConfigSource = { ...FULL_ENV };
  for (const k of keys) delete copy[k];
  return copy;
}

export const MOCK_CONFIG_SCENARIOS: readonly MockConfigScenario[] = [
  {
    id: "default",
    label: "Kondisi awal (perangkat opsional kosong)",
    description: "Wajib terisi, OLT, GenieACS, dan Billing belum diisi.",
    dataMode: "dummy",
    env: without("OLT_HSGQ_HOST", "GENIEACS_NBI_URL", "BILLING_URL"),
  },
  {
    id: "missing_router",
    label: "Router wajib belum diisi",
    description: "Host, user, dan password MikroTik kosong.",
    dataMode: "dummy",
    env: without(
      "MIKROTIK_REST_HOST",
      "MIKROTIK_REST_USER",
      "MIKROTIK_REST_PASSWORD",
    ),
  },
  {
    id: "missing_database",
    label: "Database belum diisi",
    description: "DATABASE_URL kosong (fatal).",
    dataMode: "dummy",
    env: without("DATABASE_URL"),
  },
  {
    id: "go_live_violation",
    label: "Pelanggaran go-live",
    description: "Mode nyata aktif tetapi konfigurasi belum lengkap.",
    dataMode: "nyata",
    env: without("MIKROTIK_REST_PASSWORD", "OLT_HSGQ_HOST", "BILLING_URL"),
  },
  {
    id: "all_valid",
    label: "Semua terisi lengkap",
    description: "Seluruh variabel terisi.",
    dataMode: "nyata",
    env: { ...FULL_ENV },
  },
];
