// Murni (tanpa "server-only") agar bisa diuji dengan node --test.
export interface DatabaseConnectionConfig {
  url: string;
  migrationUrl?: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  sslMode?: string;
  maxConnections: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
}

export interface DatabaseConfigValidation {
  valid: boolean;
  errors: string[];
  sanitizedUrl?: string;
}

export interface ParsedDatabaseUrl {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  sslMode?: string;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseDatabaseUrl(urlString: string): ParsedDatabaseUrl {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("DATABASE_URL bukan URL yang valid.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL harus memakai protokol postgres:// atau postgresql://.");
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database: decode(url.pathname.replace(/^\/+/, "")),
    user: decode(url.username),
    password: url.password ? decode(url.password) : undefined,
    sslMode: url.searchParams.get("sslmode") ?? undefined,
  };
}

function intFromEnv(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw.trim());
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function firstSet(...values: (string | undefined)[]): string | undefined {
  return values.find((v) => v !== undefined && v.trim() !== "");
}

export function loadDatabaseEnvConfig(
  source: Record<string, string | undefined> = process.env,
): DatabaseConnectionConfig | null {
  const url = source.DATABASE_URL?.trim();
  if (!url) return null;
  const parsed = parseDatabaseUrl(url);
  const migrationUrl = source.MIGRATION_DATABASE_URL?.trim() || undefined;
  return {
    url,
    migrationUrl,
    ...parsed,
    maxConnections: intFromEnv(
      firstSet(source.PG_MAX_CONNECTIONS, source.DATABASE_POOL_MAX),
      5,
      1,
      100,
    ),
    connectionTimeoutMs: intFromEnv(
      firstSet(source.PG_TIMEOUT_MS, source.DATABASE_TIMEOUT_MS),
      5000,
      500,
      60000,
    ),
    idleTimeoutMs: intFromEnv(
      firstSet(source.PG_IDLE_TIMEOUT_MS, source.DATABASE_IDLE_TIMEOUT_MS),
      30000,
      0,
      3600000,
    ),
  };
}

export function validateDatabaseEnvConfig(
  config: DatabaseConnectionConfig | null,
): DatabaseConfigValidation {
  if (config === null) {
    return { valid: false, errors: ["DATABASE_URL tidak ditemukan di environment."] };
  }
  const errors: string[] = [];
  if (!config.host) errors.push("Host database kosong.");
  if (!config.database) errors.push("Nama database kosong.");
  const auth = config.user ? `${config.user}${config.password ? ":***" : ""}@` : "";
  const sanitizedUrl = `postgresql://${auth}${config.host}:${config.port}/${config.database}`;
  return { valid: errors.length === 0, errors, sanitizedUrl };
}

export function formatDatabaseSanitizedSummary(config: DatabaseConnectionConfig): string {
  const auth = config.user ? `${config.user}@` : "";
  return `postgresql://${auth}${config.host}:${config.port}/${config.database} (max: ${config.maxConnections}, timeout: ${config.connectionTimeoutMs}ms)`;
}
