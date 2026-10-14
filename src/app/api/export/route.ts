import { withApiSession } from "@/lib/api";
import type {
  ExportDataset,
  ExportFormat,
  ExportTimeRange,
} from "@/lib/dashboard/export";
import { generateRealExportData } from "@/services/export.service";

export const runtime = "nodejs";

const VALID_DATASETS: Record<string, ExportDataset> = {
  "alerts-history": "alerts-history",
  alerts: "alerts-history",
  alert: "alerts-history",
  anomalies: "anomalies",
  anomali: "anomalies",
  customers: "customers",
  pelanggan: "customers",
  billing: "billing",
  tagihan: "billing",
  "audit-log": "audit-log",
  audit: "audit-log",
};

export async function GET(request: Request) {
  return withApiSession(request, async () => {
    const url = new URL(request.url);
    const rawDataset =
      url.searchParams.get("dataset") ||
      url.searchParams.get("type") ||
      "alerts-history";
    const dataset = VALID_DATASETS[rawDataset.toLowerCase()] || "alerts-history";

    const rawFormat = url.searchParams.get("format") || "csv";
    const format: ExportFormat = rawFormat.toLowerCase() === "json" ? "json" : "csv";

    const rawRange = url.searchParams.get("range") || "7d";
    const validRanges: ExportTimeRange[] = ["24h", "7d", "30d", "all"];
    const range: ExportTimeRange = validRanges.includes(rawRange as ExportTimeRange)
      ? (rawRange as ExportTimeRange)
      : "7d";

    const nowSecParam = url.searchParams.get("nowSec");
    const nowSec = nowSecParam ? parseInt(nowSecParam, 10) : Math.floor(Date.now() / 1000);

    const isDownload = url.searchParams.get("download") !== "false";
    const allowEmpty = url.searchParams.get("allowEmpty") !== "false";

    const result = await generateRealExportData(dataset, format, range, nowSec);

    if (!allowEmpty && result.rowCount === 0) {
      return Response.json(
        {
          error: {
            code: "NO_DATA",
            message: "Tidak ada data dalam rentang waktu yang dipilih.",
          },
          meta: {
            dataset,
            format,
            range,
            rowCount: 0,
            isEmpty: true,
          },
        },
        { status: 404 },
      );
    }

    if (isDownload && format === "csv") {
      return new Response(result.content, {
        status: 200,
        headers: {
          "Content-Type": result.mimeType,
          "Content-Disposition": `attachment; filename="${result.filename}"`,
          "X-Row-Count": String(result.rowCount),
          "X-Is-Empty": String(result.rowCount === 0),
        },
      });
    }

    if (isDownload && format === "json") {
      return new Response(result.content, {
        status: 200,
        headers: {
          "Content-Type": result.mimeType,
          "Content-Disposition": `attachment; filename="${result.filename}"`,
          "X-Row-Count": String(result.rowCount),
          "X-Is-Empty": String(result.rowCount === 0),
        },
      });
    }

    return Response.json({
      ok: true,
      data: result,
      isEmpty: result.rowCount === 0,
      message:
        result.rowCount === 0
          ? "Tidak ada data dalam rentang waktu yang dipilih."
          : undefined,
      meta: {
        dataset,
        format,
        range,
        rowCount: result.rowCount,
        isEmpty: result.rowCount === 0,
        filename: result.filename,
      },
    });
  });
}

export async function POST(request: Request) {
  return withApiSession(request, async () => {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // Body kosong diizinkan, gunakan default
    }

    const rawDataset = String(body.dataset || body.type || "alerts-history");
    const dataset = VALID_DATASETS[rawDataset.toLowerCase()] || "alerts-history";

    const rawFormat = String(body.format || "csv");
    const format: ExportFormat = rawFormat.toLowerCase() === "json" ? "json" : "csv";

    const rawRange = String(body.range || "7d");
    const validRanges: ExportTimeRange[] = ["24h", "7d", "30d", "all"];
    const range: ExportTimeRange = validRanges.includes(rawRange as ExportTimeRange)
      ? (rawRange as ExportTimeRange)
      : "7d";

    const nowSec =
      typeof body.nowSec === "number"
        ? body.nowSec
        : Math.floor(Date.now() / 1000);

    const allowEmpty = body.allowEmpty !== false;

    const result = await generateRealExportData(dataset, format, range, nowSec);

    if (!allowEmpty && result.rowCount === 0) {
      return Response.json(
        {
          error: {
            code: "NO_DATA",
            message: "Tidak ada data dalam rentang waktu yang dipilih.",
          },
          meta: {
            dataset,
            format,
            range,
            rowCount: 0,
            isEmpty: true,
          },
        },
        { status: 404 },
      );
    }

    return Response.json({
      ok: true,
      data: result,
      isEmpty: result.rowCount === 0,
      message:
        result.rowCount === 0
          ? "Tidak ada data dalam rentang waktu yang dipilih."
          : undefined,
      meta: {
        dataset,
        format,
        range,
        rowCount: result.rowCount,
        isEmpty: result.rowCount === 0,
        filename: result.filename,
      },
    });
  });
}
