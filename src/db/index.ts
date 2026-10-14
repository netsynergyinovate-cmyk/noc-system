import "server-only";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "@/lib/env";
import { loadDatabaseEnvConfig } from "@/lib/db-env-config";
import * as schema from "./schema";

function createPool() {
  const config = loadDatabaseEnvConfig(process.env);
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: config?.maxConnections ?? 5,
    connectionTimeoutMillis: config?.connectionTimeoutMs ?? 5000,
    idleTimeoutMillis: config?.idleTimeoutMs ?? 30000,
  });
  pool.on("error", () => {
    console.error(
      "An idle PostgreSQL connection was lost. Check database availability.",
    );
  });
  return pool;
}

// Prevent extra connection pools during development hot reloads.
const globalDb = globalThis as unknown as {
  starterPostgresDb?: ReturnType<typeof connect>;
  starterPostgresPool?: Pool;
};
let modulePool: Pool | undefined;

// Pool tunggal yang dipakai bersama Drizzle dan service SQL langsung.
export function getRawPool(): Pool {
  if (process.env.NODE_ENV !== "production")
    return (globalDb.starterPostgresPool ??= createPool());
  return (modulePool ??= createPool());
}

function connect() {
  return drizzle(getRawPool(), { schema });
}

export const db = globalDb.starterPostgresDb ?? connect();
if (process.env.NODE_ENV !== "production") globalDb.starterPostgresDb = db;
