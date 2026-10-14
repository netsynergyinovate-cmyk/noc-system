import "server-only";

import { db } from "@/db";
import { alerts, customers, networkLogs, routers } from "@/db/schema";
import {
  escapeCsvCell,
  toCsv,
  type ExportDataset,
  type ExportFormat,
  type ExportResult,
  type ExportTimeRange,
  generateExportData,
} from "@/lib/dashboard/export";
import { getBillingOverview } from "@/services/billing.service";
import { getAuditEntries } from "@/services/audit.service";
import { desc, eq, gte, sql } from "drizzle-orm";

function formatIso(date: Date | number | null | undefined): string {
  if (!date) return "-";
  if (typeof date === "number") return new Date(date * 1000).toISOString();
  return date.toISOString();
}

function getRangeSeconds(range: ExportTimeRange): number {
  switch (range) {
    case "24h":
      return 86_400;
    case "7d":
      return 7 * 86_400;
    case "30d":
      return 30 * 86_400;
    case "all":
    default:
      return Infinity;
  }
}

/**
 * Menghasilkan data laporan nyata dari database berdasarkan jenis dan rentang waktu.
 */
export async function generateRealExportData(
  dataset: ExportDataset,
  format: ExportFormat,
  range: ExportTimeRange = "7d",
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<ExportResult> {
  const dateStr = new Date(nowSec * 1000).toISOString().slice(0, 10);
  const rangeSec = getRangeSeconds(range);
  const sinceDate =
    rangeSec !== Infinity ? new Date((nowSec - rangeSec) * 1000) : new Date(0);

  try {
    if (dataset === "alerts-history") {
      const rows = await db
        .select({
          id: alerts.id,
          kind: alerts.type,
          severity: alerts.severity,
          routerId: alerts.routerId,
          customerId: alerts.customerId,
          startedAt: alerts.startedAt,
          endedAt: alerts.endedAt,
          endTimeSource: alerts.endTimeSource,
          handledBy: alerts.handledBy,
          locationName: alerts.locationName,
          locationOdp: alerts.locationOdp,
        })
        .from(alerts)
        .where(gte(alerts.createdAt, sinceDate))
        .orderBy(desc(alerts.createdAt))
        .limit(2000);

      if (rows.length > 0) {
        if (format === "json") {
          return {
            filename: `laporan-alert-${dateStr}.json`,
            mimeType: "application/json",
            content: JSON.stringify(rows, null, 2),
            rowCount: rows.length,
          };
        }

        const headers = [
          "ID",
          "Jenis",
          "Tingkat",
          "Pelanggan ID / Router",
          "Mulai",
          "Mulai (ISO)",
          "Selesai",
          "Selesai (ISO)",
          "Sumber Selesai",
          "Ditangani Oleh",
          "Lokasi",
          "ODP",
        ];
        const csvRows = rows.map((a) => [
          a.id,
          a.kind,
          a.severity,
          a.customerId ?? a.routerId ?? "-",
          a.startedAt ? Math.floor(a.startedAt.getTime() / 1000) : "-",
          formatIso(a.startedAt),
          a.endedAt ? Math.floor(a.endedAt.getTime() / 1000) : "-",
          formatIso(a.endedAt),
          a.endTimeSource ?? "-",
          a.handledBy ?? "-",
          a.locationName ?? "-",
          a.locationOdp ?? "-",
        ]);

        return {
          filename: `laporan-alert-${dateStr}.csv`,
          mimeType: "text/csv;charset=utf-8",
          content: toCsv(headers, csvRows),
          rowCount: rows.length,
        };
      }
    }

    if (dataset === "anomalies") {
      const logs = await db
        .select()
        .from(networkLogs)
        .where(gte(networkLogs.startedAt, sinceDate))
        .orderBy(desc(networkLogs.startedAt))
        .limit(2000);

      if (logs.length > 0) {
        if (format === "json") {
          return {
            filename: `laporan-anomali-${dateStr}.json`,
            mimeType: "application/json",
            content: JSON.stringify(logs, null, 2),
            rowCount: logs.length,
          };
        }

        const headers = [
          "ID",
          "Jenis",
          "Tingkat",
          "Mulai",
          "Mulai (ISO)",
          "Detail",
        ];
        const csvRows = logs.map((l) => [
          l.id,
          l.type,
          l.severity,
          Math.floor(l.startedAt.getTime() / 1000),
          formatIso(l.startedAt),
          JSON.stringify(l.detail || {}),
        ]);

        return {
          filename: `laporan-anomali-${dateStr}.csv`,
          mimeType: "text/csv;charset=utf-8",
          content: toCsv(headers, csvRows),
          rowCount: logs.length,
        };
      }
    }

    if (dataset === "customers") {
      const custList = await db
        .select({
          id: customers.id,
          name: customers.name,
          pppoeUsername: customers.pppoeUsername,
          routerId: customers.routerId,
          routerName: routers.name,
          odpName: customers.odpName,
          address: customers.address,
          latitude: customers.latitude,
          longitude: customers.longitude,
          opticalPower: customers.opticalPower,
          billingStatus: customers.billingStatus,
        })
        .from(customers)
        .leftJoin(routers, eq(routers.id, customers.routerId))
        .orderBy(customers.name);

      if (custList.length > 0) {
        if (format === "json") {
          return {
            filename: `data-pelanggan-${dateStr}.json`,
            mimeType: "application/json",
            content: JSON.stringify(custList, null, 2),
            rowCount: custList.length,
          };
        }

        const headers = [
          "ID",
          "Nama",
          "PPPoE Username",
          "Router ID",
          "ODP",
          "Alamat",
          "Latitude",
          "Longitude",
          "Daya Optik (dBm)",
          "Status Billing",
        ];
        const csvRows = custList.map((c) => [
          c.id,
          c.name,
          c.pppoeUsername,
          c.routerName ?? c.routerId,
          c.odpName ?? "-",
          c.address ?? "-",
          c.latitude ?? "-",
          c.longitude ?? "-",
          c.opticalPower ?? "-",
          c.billingStatus ?? "-",
        ]);

        return {
          filename: `data-pelanggan-${dateStr}.csv`,
          mimeType: "text/csv;charset=utf-8",
          content: toCsv(headers, csvRows),
          rowCount: custList.length,
        };
      }
    }

    if (dataset === "billing") {
      const overview = await getBillingOverview(nowSec);
      if (overview && overview.rows.length > 0) {
        if (format === "json") {
          return {
            filename: `data-billing-${dateStr}.json`,
            mimeType: "application/json",
            content: JSON.stringify(overview, null, 2),
            rowCount: overview.rows.length,
          };
        }

        const headers = [
          "Customer ID",
          "Nama Pelanggan",
          "PPPoE Username",
          "Router",
          "Status Tagihan",
          "Pencocokan",
          "Invoice Ref",
        ];
        const csvRows = overview.rows.map((b) => [
          b.customerId,
          b.name,
          b.pppoeUsername,
          b.routerName,
          b.status,
          b.match,
          b.invoiceRef ?? "-",
        ]);

        return {
          filename: `data-billing-${dateStr}.csv`,
          mimeType: "text/csv;charset=utf-8",
          content: toCsv(headers, csvRows),
          rowCount: overview.rows.length,
        };
      }
    }

    if (dataset === "audit-log") {
      const rawEntries = await getAuditEntries({ limit: 500, before: nowSec, nowSec });
      const sinceSec = rangeSec !== Infinity ? nowSec - rangeSec : 0;
      const auditEntries = rawEntries.filter((a) => a.at <= nowSec && a.at > sinceSec);
      if (auditEntries.length > 0) {
        if (format === "json") {
          return {
            filename: `jejak-aktivitas-${dateStr}.json`,
            mimeType: "application/json",
            content: JSON.stringify(auditEntries, null, 2),
            rowCount: auditEntries.length,
            isEmpty: false,
          };
        }

        const headers = [
          "ID",
          "Waktu",
          "Waktu (ISO)",
          "Pelaksana",
          "Aksi",
          "Target",
          "Ringkasan",
        ];
        const csvRows = auditEntries.map((a) => [
          a.id,
          a.at,
          formatIso(a.at),
          a.actor.name,
          a.action,
          a.target,
          a.summary,
        ]);

        return {
          filename: `jejak-aktivitas-${dateStr}.csv`,
          mimeType: "text/csv;charset=utf-8",
          content: toCsv(headers, csvRows),
          rowCount: auditEntries.length,
          isEmpty: false,
        };
      }
    }
  } catch {
    // Abaikan jika database offline
  }

  // Fallback ke data generator
  return generateExportData(dataset, format, nowSec, range);
}
