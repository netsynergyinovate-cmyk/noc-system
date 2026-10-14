// Murni: tanpa import "server-only". Mem-parsing dan memeriksa .env.example.

export type ParsedEnvExample = {
  keys: string[];
  keyValues: Record<string, string>;
  /** Komentar tepat di atas tiap kunci (blok komentar bersambung). */
  comments: Record<string, string[]>;
};

const LINE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const SECRET_SUFFIX = /(_SECRET|_PASSWORD|_KEY|_TOKEN)$/;
export const SECURITY_HEADER = "# PERINGATAN KEAMANAN: berkas ini TERLACAK di Git dan hanya template.";

export function parseEnvExample(content: string): ParsedEnvExample {
  const keys: string[] = [];
  const keyValues: Record<string, string> = Object.create(null);
  const comments: Record<string, string[]> = Object.create(null);
  let block: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (t === "") {
      block = [];
      continue;
    }
    const m = LINE.exec(line);
    if (m) {
      if (!(m[1] in keyValues)) keys.push(m[1]);
      keyValues[m[1]] = m[2].trim();
      comments[m[1]] = block;
      block = [];
    } else if (t.startsWith("#")) {
      block.push(t.replace(/^#\s?/, ""));
    }
  }
  return { keys, keyValues, comments };
}

export function validateEnvExampleSecurity(content: string): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  if (content.split(/\r?\n/)[0] !== SECURITY_HEADER) violations.push("header peringatan keamanan hilang di baris 1");
  const { keyValues } = parseEnvExample(content);
  for (const [k, v] of Object.entries(keyValues)) {
    if (SECRET_SUFFIX.test(k) && v !== "") violations.push(`${k} harus kosong`);
  }
  return { ok: violations.length === 0, violations };
}

export function checkEnvCoverage(
  exampleKeys: string[],
  expectedKeys: string[],
): { covered: boolean; missing: string[] } {
  const have = new Set(exampleKeys);
  const missing = expectedKeys.filter((k) => !have.has(k));
  return { covered: missing.length === 0, missing };
}

// Variabel inti CentralConfig, DeviceEnv, dan DbConfig.
export const EXPECTED_ENV_KEYS: readonly string[] = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "TRUSTED_PROXIES",
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "PG_MAX_CONNECTIONS",
  "PG_TIMEOUT_MS",
  "PG_IDLE_TIMEOUT_MS",
  "DASHBOARD_DATA",
  "DATA_MODE",
  "DEVICE_MODE",
  "MIKROTIK_MODE",
  "MIKROTIK_REST_HOST",
  "MIKROTIK_REST_PORT",
  "MIKROTIK_REST_USER",
  "MIKROTIK_REST_PASSWORD",
  "OLT_MODE",
  "OLT_HSGQ_HOST",
  "OLT_HSGQ_PORT",
  "OLT_HSGQ_USER",
  "OLT_HSGQ_PASSWORD",
  "GENIEACS_MODE",
  "GENIEACS_NBI_URL",
  "GENIEACS_NBI_USER",
  "GENIEACS_NBI_PASSWORD",
  "GENIEACS_TIMEOUT_MS",
  "BILLING_MODE",
  "BILLING_URL",
  "BILLING_PORTAL_URL",
  "BILLING_USERNAME",
  "BILLING_PASSWORD",
  "BILLING_SYNC_MINUTE",
  "BILLING_DROP_PERCENT",
  "BILLING_DROP_MIN_INVOICES",
  "BACKEND_URL",
  "REALTIME_TOKEN_SECRET",
  "PPP_WEBHOOK_TOKEN",
  "PORT",
  "SYSLOG_ADDR",
  "NETFLOW_ADDR",
  "DEVICE_SECRET",
  "WHATSAPP_API_KEY",
  "SEED_ADMIN_EMAIL",
  "SEED_ADMIN_NAME",
  "SEED_ADMIN_PASSWORD",
  "SEED_VIEWER_EMAIL",
  "SEED_VIEWER_NAME",
  "SEED_VIEWER_PASSWORD",
  "TIMESCALE_ENABLED",
  "TRAFFIC_RETENTION_DAYS",
];
