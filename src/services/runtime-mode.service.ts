import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getRawPool } from "@/db";

export type EnvironmentType = "local" | "server";
export type DataModeType = "demo" | "live";

function persistEnvConfig(key: string, value: string) {
  try {
    const envPath = resolve(process.cwd(), ".env.local");
    if (existsSync(envPath)) {
      let content = readFileSync(envPath, "utf-8");
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (regex.test(content)) {
        content = content.replace(regex, `${key}="${value}"`);
      } else {
        content = `${content.trimEnd()}\n${key}="${value}"\n`;
      }
      writeFileSync(envPath, content, "utf-8");
    }
  } catch {
    // Abaikan jika env file tidak dapat ditulis
  }
}

export interface EnvironmentInfo {
  environment: EnvironmentType;
  isLocalhost: boolean;
  host: string;
  label: string;
  description: string;
}

export interface RuntimeModeStatus {
  dataMode: DataModeType;
  modeLabel: string;
  dummyDataDisabled: boolean;
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
 * Membaca status runtime mode operasional dan ketersediaan database.
 */
export async function getRuntimeModeStatus(
  hostHeader?: string | null,
): Promise<RuntimeModeStatus> {
  const dataMode: DataModeType =
    process.env.DASHBOARD_DATA === "live" || process.env.DATA_MODE === "nyata"
      ? "live"
      : "demo";

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
        client.query("SELECT COUNT(*) AS c FROM \"routers\"").catch(() => ({ rows: [{ c: 0 }] })),
        client.query("SELECT COUNT(*) AS c FROM \"olts\"").catch(() => ({ rows: [{ c: 0 }] })),
        client.query("SELECT COUNT(*) AS c FROM \"alerts\"").catch(() => ({ rows: [{ c: 0 }] })),
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
    dataMode,
    modeLabel: dataMode === "live" ? "Mode Live (Data Nyata)" : "Mode Simulasi (Demo)",
    dummyDataDisabled: dataMode === "live",
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

/**
 * Mengubah runtime mode (Live vs Simulasi).
 * Saat live: flag DASHBOARD_DATA disetel "live" dan DATA_MODE "nyata",
 * data dummy ditiadakan dan operasi diarahkan ke database PostgreSQL.
 */
export async function setRuntimeMode(
  targetMode: DataModeType,
  hostHeader?: string | null,
): Promise<RuntimeModeStatus> {
  if (targetMode === "live") {
    process.env.DASHBOARD_DATA = "live";
    process.env.DATA_MODE = "nyata";
    persistEnvConfig("DASHBOARD_DATA", "live");
    persistEnvConfig("DATA_MODE", "nyata");
  } else {
    process.env.DASHBOARD_DATA = "demo";
    process.env.DATA_MODE = "dummy";
    persistEnvConfig("DASHBOARD_DATA", "demo");
    persistEnvConfig("DATA_MODE", "dummy");
  }

  return getRuntimeModeStatus(hostHeader);
}
