// Lib murni untuk panel ekspor data dan laporan (PRD Fase 6).
// Kontrak masa depan ke REST:
// GET /api/v1/export?dataset=alerts|anomalies|customers|audit|billing&format=csv|json&range=...
// Untuk saat ini: mengekspor data yang sudah ada di frontend/mock data secara murni ke CSV dan JSON.

import { ALERT_HISTORY_SECONDS, mockResolvedAlerts } from "./alerts.ts";
import { mockAuditLog } from "./audit.ts";
import { mockBillingOverview } from "./billing.ts";
import { mockIncidents } from "./history.ts";
import type { DashboardCustomer } from "./types.ts";

const routerNameOf = (id: string) => id;

export type ExportTimeRange = "24h" | "7d" | "30d" | "all";

export interface TimeRangeOption {
  id: ExportTimeRange;
  label: string;
  seconds: number; // 86400, 604800, 2592000, atau Infinity
}

export const EXPORT_TIME_RANGES: readonly TimeRangeOption[] = [
  { id: "24h", label: "24 Jam Terakhir", seconds: 86_400 },
  { id: "7d", label: "7 Hari Terakhir", seconds: 7 * 86_400 },
  { id: "30d", label: "30 Hari Terakhir", seconds: 30 * 86_400 },
  { id: "all", label: "Semua Data Tersedia", seconds: Infinity },
];

export const EXPORT_DATA_MOCK_ENTRY = {
  id: "export-reports-data",
  module: "Ekspor Data & Laporan",
  targetDevice: "Agregator Data Laporan / DB",
  status: "dummy" as const,
  readPath: "src/lib/dashboard/export.ts (generateExportData)",
  writePath: "-",
  envKey: "DASHBOARD_DATA",
  notes:
    "Tiruan sementara data generator ekspor CSV/JSON; wajib dialihkan ke query backend nyata di Fase 5",
};

// Jendela data tiruan terpanjang per dataset berbasis waktu ("all").
const ALERTS_MAX_SECONDS = ALERT_HISTORY_SECONDS;
const ANOMALIES_MAX_SECONDS = 7 * 86_400;
const AUDIT_MAX_SECONDS = 30 * 86_400;

function windowSeconds(range: ExportTimeRange, maxSeconds: number): number {
  const opt = EXPORT_TIME_RANGES.find((r) => r.id === range);
  const secs = opt ? opt.seconds : 7 * 86_400;
  return Math.min(secs, maxSeconds);
}

export type ExportDataset =
  "alerts-history" | "anomalies" | "customers" | "billing" | "audit-log";

export type ExportFormat = "csv" | "json";

export interface DatasetOption {
  id: ExportDataset;
  label: string;
  description: string;
  recordCount: (nowSec: number, range?: ExportTimeRange) => number;
}

export const EXPORT_DATASETS: readonly DatasetOption[] = [
  {
    id: "alerts-history",
    label: "Riwayat Alert Selesai",
    description:
      "Daftar alert gangguan 7 hari terakhir beserta waktu mulai, selesai, dan penanganannya.",
    recordCount: (nowSec, range = "7d") =>
      mockResolvedAlerts(nowSec, windowSeconds(range, ALERTS_MAX_SECONDS))
        .length,
  },
  {
    id: "anomalies",
    label: "Laporan Anomali & Insiden",
    description:
      "Insiden anomali traffic, CPU, optik, offline, dan port error dalam 7 hari terakhir.",
    recordCount: (nowSec, range = "7d") =>
      mockIncidents(
        nowSec - windowSeconds(range, ANOMALIES_MAX_SECONDS),
        nowSec,
        nowSec,
      ).length,
  },
  {
    id: "customers",
    label: "Data Pelanggan & Jaringan",
    description:
      "Daftar seluruh pelanggan PPPoE, router pelayan, ODP, koordinat, dan status optik.",
    recordCount: () => 0,
  },
  {
    id: "billing",
    label: "Status Tagihan & Billing",
    description:
      "Status pembayaran pelanggan (Lunas/Isolir), rujukan invoice, dan kecocokan data.",
    recordCount: (nowSec) => mockBillingOverview(nowSec).rows.length,
  },
  {
    id: "audit-log",
    label: "Jejak Aktivitas Petugas",
    description:
      "Catatan tindakan petugas NOC (login, ubah ambang, router, cpe) 30 hari terakhir.",
    recordCount: (nowSec, range = "7d") => {
      const since = nowSec - windowSeconds(range, AUDIT_MAX_SECONDS);
      return mockAuditLog(nowSec).filter((a) => a.at > since).length;
    },
  },
] as const;

// Helper sanitasi sel CSV (RFC 4180 + pencegahan formula injection di Excel/Sheets)
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str = String(value);

  // Formula injection mitigation: prefix leading [=, +, -, @, \t, \r] with a single quote
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // Bungkus quotes jika mengandung koma, kutip ganda, atau baris baru
  if (/[",\r\n]/.test(str)) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

export function toCsv(
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][],
): string {
  const headerLine = headers.map(escapeCsvCell).join(",");
  const dataLines = rows.map((r) => r.map(escapeCsvCell).join(","));
  return [headerLine, ...dataLines].join("\r\n");
}

export interface ExportResult {
  filename: string;
  mimeType: string;
  content: string;
  rowCount: number;
  isEmpty?: boolean;
}

function formatIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

export function generateExportData(
  dataset: ExportDataset,
  format: ExportFormat,
  nowSec: number,
  range: ExportTimeRange = "7d",
): ExportResult {
  const dateStr = new Date(nowSec * 1000).toISOString().slice(0, 10);

  if (dataset === "alerts-history") {
    const list = mockResolvedAlerts(
      nowSec,
      windowSeconds(range, ALERTS_MAX_SECONDS),
    );
    if (format === "json") {
      return {
        filename: `laporan-alert-${dateStr}.json`,
        mimeType: "application/json",
        content: JSON.stringify(list, null, 2),
        rowCount: list.length,
        isEmpty: list.length === 0,
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
    const rows = list.map((a) => [
      a.id,
      a.kind,
      a.severity,
      a.customerId ?? routerNameOf(a.routerId),
      a.startedAt,
      formatIso(a.startedAt),
      a.endedAt,
      formatIso(a.endedAt),
      a.endTimeSource,
      a.handledBy ?? "-",
      a.location.name,
      a.location.odpName ?? "-",
    ]);
    return {
      filename: `laporan-alert-${dateStr}.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: toCsv(headers, rows),
      rowCount: list.length,
      isEmpty: list.length === 0,
    };
  }

  if (dataset === "anomalies") {
    const list = mockIncidents(
      nowSec - windowSeconds(range, ANOMALIES_MAX_SECONDS),
      nowSec,
      nowSec,
    );
    if (format === "json") {
      return {
        filename: `laporan-anomali-${dateStr}.json`,
        mimeType: "application/json",
        content: JSON.stringify(list, null, 2),
        rowCount: list.length,
        isEmpty: list.length === 0,
      };
    }
    const headers = [
      "ID",
      "Jenis",
      "Tingkat",
      "Mulai",
      "Mulai (ISO)",
      "Selesai",
      "Selesai (ISO)",
    ];
    const rows = list.map((inc) => [
      inc.id,
      inc.kind,
      inc.severity,
      inc.startedAt,
      formatIso(inc.startedAt),
      inc.endedAt ?? "",
      inc.endedAt ? formatIso(inc.endedAt) : "Berjalan",
    ]);
    return {
      filename: `laporan-anomali-${dateStr}.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: toCsv(headers, rows),
      rowCount: list.length,
      isEmpty: list.length === 0,
    };
  }

  if (dataset === "customers") {
    const list: DashboardCustomer[] = [];
    if (format === "json") {
      return {
        filename: `data-pelanggan-${dateStr}.json`,
        mimeType: "application/json",
        content: JSON.stringify(list, null, 2),
        rowCount: list.length,
        isEmpty: list.length === 0,
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
      "Status Online",
      "Daya Optik (dBm)",
      "Status Billing",
    ];
    const rows = list.map((c) => [
      c.id,
      c.name,
      c.pppoeUsername,
      c.routerId,
      c.odpName,
      c.address,
      c.latitude,
      c.longitude,
      c.isOnline ? "Online" : "Offline",
      c.opticalPowerDbm,
      c.billingStatus,
    ]);
    return {
      filename: `data-pelanggan-${dateStr}.csv`,
      mimeType: "text/csv;charset=utf-8",
      content: toCsv(headers, rows),
      rowCount: list.length,
      isEmpty: list.length === 0,
    };
  }

  if (dataset === "billing") {
    const overview = mockBillingOverview(nowSec);
    const list = overview.rows;
    if (format === "json") {
      return {
        filename: `data-billing-${dateStr}.json`,
        mimeType: "application/json",
        content: JSON.stringify(overview, null, 2),
        rowCount: list.length,
        isEmpty: list.length === 0,
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
    const rows = list.map((b) => [
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
      content: toCsv(headers, rows),
      rowCount: list.length,
      isEmpty: list.length === 0,
    };
  }

  // audit-log
  const auditSince = nowSec - windowSeconds(range, AUDIT_MAX_SECONDS);
  const list = mockAuditLog(nowSec).filter((a) => a.at > auditSince);
  if (format === "json") {
    return {
      filename: `jejak-aktivitas-${dateStr}.json`,
      mimeType: "application/json",
      content: JSON.stringify(list, null, 2),
      rowCount: list.length,
      isEmpty: list.length === 0,
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
  const rows = list.map((a) => [
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
    content: toCsv(headers, rows),
    rowCount: list.length,
    isEmpty: list.length === 0,
  };
}

export interface ExportPreviewData {
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  isEmpty: boolean;
  estimatedSizeKb: number;
}

// Parser CSV kecil (RFC 4180) untuk keluaran toCsv; cukup untuk pratinjau.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

export function getExportPreview(
  dataset: ExportDataset,
  nowSec: number,
  range: ExportTimeRange = "7d",
  previewLimit = 3,
): ExportPreviewData {
  const csv = generateExportData(dataset, "csv", nowSec, range);
  const [headers = [], ...body] = parseCsv(csv.content);
  const limit = Math.max(0, Math.min(5, Math.floor(previewLimit)));
  const sampleRows = csv.rowCount === 0 ? [] : body.slice(0, limit);
  const bytes = new TextEncoder().encode(csv.content).length;
  return {
    headers,
    sampleRows,
    totalRows: csv.rowCount,
    isEmpty: csv.rowCount === 0,
    estimatedSizeKb: Math.max(0.1, Math.round((bytes / 1024) * 10) / 10),
  };
}
