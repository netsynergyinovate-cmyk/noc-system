import { db } from "@/db";
import { sql } from "drizzle-orm";
import { deployConfigSyncs, type DeployConfigSync } from "@/db/schema/deploy-runs";

export interface ConfigTableConfig {
  table: string;
  name: string;
  description: string;
  conflictTarget: string;
  allowedUpdateColumns: readonly string[];
}

export const SYNCABLE_CONFIG_TABLES: readonly ConfigTableConfig[] = [
  {
    table: "routers",
    name: "Router MikroTik",
    description: "Daftar router dan kredensial terenkripsi",
    conflictTarget: '"host"',
    allowedUpdateColumns: ["name", "username", "password_enc", "latitude", "longitude"],
  },
  {
    table: "olts",
    name: "OLT HSGQ",
    description: "Perangkat OLT dan pengaturan interface",
    conflictTarget: '"host"',
    allowedUpdateColumns: [
      "name",
      "brand",
      "driver",
      "username",
      "password_enc",
      "latitude",
      "longitude",
      "tr069_autobind_since",
    ],
  },
  {
    table: "alert_thresholds",
    name: "Ambang Alert",
    description: "Aturan ambang batas KPI dan toleransi alert",
    conflictTarget: '"rule_kind"',
    allowedUpdateColumns: ["threshold", "for_seconds", "updated_at"],
  },
  {
    table: "ont_web_settings",
    name: "Web Admin ONT",
    description: "Pengaturan login modem CPE via web",
    conflictTarget: '"id"',
    allowedUpdateColumns: [
      "acs_url",
      "acs_username",
      "acs_password_enc",
      "inform_interval",
      "web_username",
      "web_password_enc",
      "zimlink_username",
      "zimlink_password_enc",
      "ggclink_username",
      "ggclink_password_enc",
      "f609_username",
      "f609_password_enc",
      "updated_at",
    ],
  },
  {
    table: "whatsapp_recipients",
    name: "Penerima WhatsApp",
    description: "Nomor tujuan notifikasi alert tim",
    conflictTarget: '"target"',
    allowedUpdateColumns: ["name", "type", "is_active", "updated_at"],
  },
  {
    table: "network_infrastructure",
    name: "Infrastruktur Jaringan",
    description: "Server, core switch, dan ODF",
    conflictTarget: '"id"',
    allowedUpdateColumns: ["name", "category", "type", "model", "latitude", "longitude", "notes"],
  },
  {
    table: "customers",
    name: "Pelanggan & PPPoE",
    description: "Data pelanggan, paket, dan pemetaan IP",
    conflictTarget: '"pppoe_username"',
    allowedUpdateColumns: ["name", "address", "latitude", "longitude", "odp_name"],
  },
] as const;

export interface ConfigTablePreview {
  table: string;
  name: string;
  rowCount: number;
  description: string;
}

export interface ConfigSyncTableResult {
  table: string;
  inserted: number;
  updated: number;
  skipped: number;
  status: "berhasil" | "gagal" | "dilewati";
  error?: string;
}

/**
 * Mendapatkan ringkasan jumlah baris konfigurasi di localhost sebelum dikirim ke server.
 */
export async function previewConfigTransfer(): Promise<ConfigTablePreview[]> {
  const previews: ConfigTablePreview[] = [];

  for (const item of SYNCABLE_CONFIG_TABLES) {
    try {
      const res = await db.execute<{ count: string }>(
        sql.raw(`SELECT count(*) as count FROM "${item.table}"`),
      );
      const rowCount = parseInt(res.rows[0]?.count || "0", 10);
      previews.push({
        table: item.table,
        name: item.name,
        rowCount,
        description: item.description,
      });
    } catch {
      previews.push({
        table: item.table,
        name: item.name,
        rowCount: 0,
        description: item.description,
      });
    }
  }

  return previews;
}

/**
 * Mengambil seluruh data konfigurasi dari localhost dalam format JSON terstruktur.
 */
export async function exportLocalConfigData(): Promise<Record<string, Record<string, unknown>[]>> {
  const data: Record<string, Record<string, unknown>[]> = {};

  for (const item of SYNCABLE_CONFIG_TABLES) {
    try {
      const res = await db.execute(sql.raw(`SELECT * FROM "${item.table}"`));
      data[item.table] = res.rows as Record<string, unknown>[];
    } catch {
      data[item.table] = [];
    }
  }

  return data;
}

/**
 * Menghasilkan skrip SQL upsert idempoten per tabel dengan:
 * 1. Kunci konflik alami (natural unique key) per tabel.
 * 2. Hanya memperbarui kolom konfigurasi aman (tidak menimpa last_seen_at, status, online, created_at).
 */
export function generateTableUpsertSql(
  tableName: string,
  rows: Record<string, unknown>[],
  routerHostMap?: Map<string, string>,
): string {
  if (!rows || rows.length === 0) return "";

  const cfg = SYNCABLE_CONFIG_TABLES.find((c) => c.table === tableName);
  if (!cfg) return "";

  const allColumns = Object.keys(rows[0]);
  const columnList = allColumns.map((c) => `"${c}"`).join(", ");

  // Filter kolom update hanya yang masuk daftar izinkan
  const validUpdateColumns = cfg.allowedUpdateColumns.filter((c) => allColumns.includes(c));
  if (validUpdateColumns.length === 0) return "";

  const updateClause = validUpdateColumns
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(", ");

  const valuesClauses = rows.map((row) => {
    const formatted = allColumns.map((col) => {
      const val = row[col];
      if (tableName === "alert_thresholds" && col === "updated_by") {
        return "NULL";
      }
      if (tableName === "customers" && col === "router_id" && routerHostMap && typeof val === "string") {
        const rHost = routerHostMap.get(val);
        if (rHost) {
          return `COALESCE((SELECT "id" FROM "routers" WHERE "host" = '${rHost}' LIMIT 1), '${val}')`;
        }
      }
      if (val === null || val === undefined) return "NULL";
      if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
      if (typeof val === "number") return String(val);
      if (val instanceof Date) return `'${val.toISOString()}'`;
      if (Array.isArray(val)) {
        const escaped = JSON.stringify(val).replace(/'/g, "''");
        return `'${escaped}'::jsonb`;
      }
      if (typeof val === "object") {
        return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
      }
      return `'${String(val).replace(/'/g, "''")}'`;
    });
    return `(${formatted.join(", ")})`;
  });

  return `INSERT INTO "${tableName}" (${columnList})\nVALUES\n  ${valuesClauses.join(",\n  ")}\nON CONFLICT (${cfg.conflictTarget}) DO UPDATE SET\n  ${updateClause};`;
}

/**
 * Mencatat hasil sinkronisasi konfigurasi ke tabel deploy_config_syncs.
 */
export async function recordConfigSync(
  runId: string,
  result: ConfigSyncTableResult,
): Promise<DeployConfigSync> {
  const [row] = await db
    .insert(deployConfigSyncs)
    .values({
      runId,
      tabel: result.table,
      disisipkan: result.inserted,
      diperbarui: result.updated,
      dilewati: result.skipped,
      status: result.status,
    })
    .returning();
  return row;
}
