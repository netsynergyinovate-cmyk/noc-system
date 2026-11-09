import "server-only";
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { getRawPool } from "@/db";
import {
  getTransferConnectionConfig,
} from "@/lib/transfer-config";
import {
  TRANSFERRABLE_TABLES,
  type TransferrableTable,
} from "./data-transfer.service";

export interface TableDriftItem {
  table: TransferrableTable;
  sourceCount: number;
  targetCount: number | null;
  countDiff: number;
  sourceChecksum: string;
  targetChecksum: string | null;
  checksumMatched: boolean;
  status: "in_sync" | "target_missing_records" | "source_missing_records" | "content_mismatch" | "target_empty" | "unverified";
}

export interface EnvironmentDriftReport {
  sourceMasked: string;
  targetMasked: string;
  sourceReachable: boolean;
  targetReachable: boolean;
  driftStatus: "in_sync" | "drift_detected" | "target_empty" | "target_unreachable" | "source_unreachable";
  totalSourceRecords: number;
  totalTargetRecords: number;
  inSyncTablesCount: number;
  driftedTablesCount: number;
  recommendation: "no_action" | "needs_transfer" | "needs_seed" | "configure_target" | "check_source";
  recommendationText: string;
  tables: TableDriftItem[];
  checkedAt: string;
  durationMs: number;
}

export interface DataDriftOptions {
  sourceDatabaseUrl?: string;
  targetDatabaseUrl?: string;
  tables?: TransferrableTable[];
  logger?: (line: string) => void;
}

export function computeTableChecksum(rows: unknown[]): string {
  if (!rows || rows.length === 0) return "sha256-empty";
  const json = JSON.stringify(rows);
  return `sha256-${createHash("sha256").update(json).digest("hex").slice(0, 16)}`;
}

/**
 * Service untuk membandingkan jumlah baris, checksum, dan mendeteksi drift data antar lingkungan (lokal vs target server).
 */
export async function detectEnvironmentDataDrift(
  options: DataDriftOptions = {},
): Promise<EnvironmentDriftReport> {
  const startTime = Date.now();
  const cfg = getTransferConnectionConfig();
  const targetUrl = options.targetDatabaseUrl ?? cfg.targetDatabaseUrl;
  const tables = options.tables ?? [...TRANSFERRABLE_TABLES];

  const customSource = !!options.sourceDatabaseUrl;
  const sourcePool = customSource
    ? new Pool({ connectionString: options.sourceDatabaseUrl, connectionTimeoutMillis: 2000 })
    : getRawPool();
  let sourceClient: PoolClient | null = null;
  let sourceReachable = false;

  try {
    sourceClient = await sourcePool.connect();
    sourceReachable = true;
  } catch {
    sourceReachable = false;
  }

  if (!sourceReachable || !sourceClient) {
    if (customSource) await sourcePool.end().catch(() => {});
    return {
      sourceMasked: cfg.sourceMaskedUrl,
      targetMasked: cfg.targetMaskedUrl ?? "-",
      sourceReachable: false,
      targetReachable: false,
      driftStatus: "source_unreachable",
      totalSourceRecords: 0,
      totalTargetRecords: 0,
      inSyncTablesCount: 0,
      driftedTablesCount: 0,
      recommendation: "check_source",
      recommendationText: "Basis data lokal tidak dapat dijangkau. Periksa koneksi DATABASE_URL.",
      tables: tables.map((t) => ({
        table: t,
        sourceCount: 0,
        targetCount: null,
        countDiff: 0,
        sourceChecksum: "sha256-unreachable",
        targetChecksum: null,
        checksumMatched: false,
        status: "unverified",
      })),
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
  }

  let targetPool: Pool | null = null;
  let targetClient: PoolClient | null = null;
  let targetReachable = false;

  if (targetUrl) {
    try {
      targetPool = new Pool({
        connectionString: targetUrl,
        max: 1,
        connectionTimeoutMillis: 5000,
      });
      targetClient = await targetPool.connect();
      targetReachable = true;
    } catch {
      targetReachable = false;
    }
  }

  const tableReports: TableDriftItem[] = [];
  let totalSource = 0;
  let totalTarget = 0;

  try {
    for (const table of tables) {
      // 1. Baca sumber lokal
      let sourceCount = 0;
      let sourceChecksum = "sha256-empty";

      try {
        const srcRes = await sourceClient.query(`SELECT * FROM ${table}`);
        sourceCount = srcRes.rows.length;
        sourceChecksum = computeTableChecksum(srcRes.rows);
      } catch {
        sourceCount = 0;
      }
      totalSource += sourceCount;

      // 2. Baca target server bila terjangkau
      let targetCount: number | null = null;
      let targetChecksum: string | null = null;

      if (targetReachable && targetClient) {
        try {
          const tgtRes = await targetClient.query(`SELECT * FROM ${table}`);
          targetCount = tgtRes.rows.length;
          targetChecksum = computeTableChecksum(tgtRes.rows);
          totalTarget += targetCount;
        } catch {
          targetCount = 0;
          targetChecksum = "sha256-empty";
        }
      }

      // 3. Evaluasi drift
      const matched =
        targetChecksum !== null && sourceChecksum === targetChecksum;
      let status: TableDriftItem["status"] = "unverified";

      if (!targetReachable) {
        status = "unverified";
      } else if (targetCount === 0 && sourceCount > 0) {
        status = "target_empty";
      } else if (matched) {
        status = "in_sync";
      } else if (targetCount !== null && targetCount < sourceCount) {
        status = "target_missing_records";
      } else if (targetCount !== null && targetCount > sourceCount) {
        status = "source_missing_records";
      } else {
        status = "content_mismatch";
      }

      const diff = targetCount !== null ? targetCount - sourceCount : 0;

      tableReports.push({
        table,
        sourceCount,
        targetCount,
        countDiff: diff,
        sourceChecksum,
        targetChecksum,
        checksumMatched: matched,
        status,
      });
    }

    const inSyncCount = tableReports.filter((t) => t.status === "in_sync").length;
    const driftedCount = tableReports.filter(
      (t) => t.status !== "in_sync" && t.status !== "unverified",
    ).length;

    let overallDrift: EnvironmentDriftReport["driftStatus"] = "in_sync";
    let recommendation: EnvironmentDriftReport["recommendation"] = "no_action";
    let recommendationText = "Data lokal dan server telah sinkron sepenuhnya.";

    if (!targetReachable) {
      overallDrift = "target_unreachable";
      recommendation = "configure_target";
      recommendationText =
        "Target server tidak dapat dijangkau. Konfigurasikan TARGET_DATABASE_URL untuk pemeriksaan drift nyata.";
    } else if (totalTarget === 0 && totalSource > 0) {
      overallDrift = "target_empty";
      recommendation = "needs_transfer";
      recommendationText =
        "Basis data target masih kosong. Jalankan transfer penuh dari lokal ke server.";
    } else if (driftedCount > 0) {
      overallDrift = "drift_detected";
      recommendation = "needs_transfer";
      recommendationText = `Terdeteksi perbedaan pada ${driftedCount} tabel. Jalankan transfer transaksional atau penyelarasan data.`;
    }

    return {
      sourceMasked: cfg.sourceMaskedUrl,
      targetMasked: cfg.targetMaskedUrl ?? "-",
      sourceReachable: true,
      targetReachable,
      driftStatus: overallDrift,
      totalSourceRecords: totalSource,
      totalTargetRecords: totalTarget,
      inSyncTablesCount: inSyncCount,
      driftedTablesCount: driftedCount,
      recommendation,
      recommendationText,
      tables: tableReports,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
  } finally {
    if (sourceClient) sourceClient.release();
    if (customSource) await sourcePool.end();
    if (targetClient) targetClient.release();
    if (targetPool) await targetPool.end();
  }
}
