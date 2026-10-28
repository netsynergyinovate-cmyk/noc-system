import { getRawPool } from "@/db";

export type EnvironmentType = "local" | "server";

export interface EnvironmentInfo {
  environment: EnvironmentType;
  isLocalhost: boolean;
  host: string;
  label: string;
  description: string;
}

export interface RuntimeModeStatus {
  databaseConnected: boolean;
  databaseDestination: string;
  environmentInfo: EnvironmentInfo;
  dbStats: {
    routers: number;
    olts: number;
    alerts: number;
  };
  checkedAt: string;
}

/**
 * Deteksi apakah aplikasi berjalan di localhost atau di server remote.
 */
export function detectEnvironment(hostHeader?: string | null): EnvironmentInfo {
  const host = (
    hostHeader ||
    process.env.BETTER_AUTH_URL ||
    "localhost:3000"
  ).replace(/^https?:\/\//i, "").split("/")[0].split(":")[0].toLowerCase();

  const isLocalhost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.includes("localhost");

  const environment: EnvironmentType = isLocalhost ? "local" : "server";

  return {
    environment,
    isLocalhost,
    host,
    label: isLocalhost ? "Local (localhost)" : "Server (Remote / VPS)",
    description: isLocalhost
      ? "Aplikasi sedang berjalan di komputer lokal (localhost / 127.0.0.1)."
      : "Aplikasi sedang berjalan di server remote (hosting / cloud VPS, bukan localhost).",
  };
}

/**
 * Membaca status runtime operasional dan ketersediaan database.
 */
export async function getRuntimeModeStatus(
  hostHeader?: string | null,
): Promise<RuntimeModeStatus> {
  let databaseConnected = false;
  let routersCount = 0;
  let oltsCount = 0;
  let alertsCount = 0;

  try {
    const pool = getRawPool();
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      databaseConnected = true;

      const [rRes, oRes, aRes] = await Promise.all([
        client.query('SELECT COUNT(*) AS c FROM "routers"').catch(() => ({ rows: [{ c: 0 }] })),
        client.query('SELECT COUNT(*) AS c FROM "olts"').catch(() => ({ rows: [{ c: 0 }] })),
        client.query('SELECT COUNT(*) AS c FROM "alerts"').catch(() => ({ rows: [{ c: 0 }] })),
      ]);

      routersCount = Number(rRes.rows[0]?.c ?? 0);
      oltsCount = Number(oRes.rows[0]?.c ?? 0);
      alertsCount = Number(aRes.rows[0]?.c ?? 0);
    } finally {
      client.release();
    }
  } catch {
    databaseConnected = false;
  }

  const envInfo = detectEnvironment(hostHeader);

  return {
    databaseConnected,
    databaseDestination: databaseConnected
      ? "PostgreSQL Active Database"
      : "Database Disconnected",
    environmentInfo: envInfo,
    dbStats: {
      routers: routersCount,
      olts: oltsCount,
      alerts: alertsCount,
    },
    checkedAt: new Date().toISOString(),
  };
}
