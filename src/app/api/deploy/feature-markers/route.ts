import { NextRequest, NextResponse } from "next/server";
import { withApiPermission } from "@/lib/api";
import {
  getFeatureMarkerStats,
  listFeatureMarkers,
  updateFeatureMarker,
  deleteFeatureMarker,
} from "@/services/feature-markers.service";
import {
  featureMarkerIdSchema,
  listFeatureMarkersSchema,
  updateFeatureMarkerSchema,
} from "@/validators/feature-markers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-monitor-token",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function verifyMonitorToken(request: NextRequest): boolean {
  const expectedToken = process.env.MONITOR_TOKEN;
  if (!expectedToken) return false;
  const reqToken =
    request.headers.get("x-monitor-token") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(reqToken && reqToken === expectedToken);
}

export async function GET(request: NextRequest) {
  // 1. Dukungan akses via Token Monitor (untuk remote proxy)
  if (verifyMonitorToken(request)) {
    const url = new URL(request.url);
    const query = listFeatureMarkersSchema.parse(
      Object.fromEntries(url.searchParams),
    );
    const [markersResult, stats] = await Promise.all([
      listFeatureMarkers(query),
      getFeatureMarkerStats(),
    ]);
    return NextResponse.json(
      {
        data: markersResult.data,
        meta: markersResult.meta,
        stats,
      },
      { headers: CORS_HEADERS },
    );
  }

  // 2. Akses via Sesi Login Developer / System Manage
  return withApiPermission(request, { system: ["manage"] }, async () => {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get("url");
    const token = searchParams.get("token") || "";

    // Jika targetUrl diberikan, proxy ke remote server
    if (targetUrl) {
      try {
        const cleanUrl = targetUrl.replace(/\/+$/, "") + "/api/deploy/feature-markers";
        const forwardUrl = new URL(cleanUrl);
        searchParams.forEach((val, key) => {
          if (key !== "url" && key !== "token") {
            forwardUrl.searchParams.set(key, val);
          }
        });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const headers: Record<string, string> = { Accept: "application/json" };
        if (token) headers["x-monitor-token"] = token;

        const res = await fetch(forwardUrl.toString(), {
          headers,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) {
          const errorJson = await res.json().catch(() => null);
          return NextResponse.json(
            {
              error:
                errorJson?.error ||
                `Gagal mengambil tanda fitur dari remote server (HTTP ${res.status})`,
            },
            { status: res.status },
          );
        }

        const data = await res.json();
        return NextResponse.json(data);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Kesalahan koneksi proxy";
        return NextResponse.json(
          { error: `Tidak dapat menghubungi remote server: ${message}` },
          { status: 502 },
        );
      }
    }

    // Jika tanpa targetUrl, ambil dari database lokal langsung
    const query = listFeatureMarkersSchema.parse(
      Object.fromEntries(searchParams),
    );
    const [markersResult, stats] = await Promise.all([
      listFeatureMarkers(query),
      getFeatureMarkerStats(),
    ]);

    return NextResponse.json({
      data: markersResult.data,
      meta: markersResult.meta,
      stats,
    });
  });
}

export async function PATCH(request: NextRequest) {
  // Mendukung akses via Monitor Token
  if (verifyMonitorToken(request)) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Parameter id wajib diisi." }, { status: 400 });
    }
    featureMarkerIdSchema.parse(id);
    const body = await request.json().catch(() => ({}));
    const input = updateFeatureMarkerSchema.parse(body);
    const updated = await updateFeatureMarker(id, input);
    if (!updated) {
      return NextResponse.json({ error: "Tanda fitur tidak ditemukan." }, { status: 404 });
    }
    return NextResponse.json({ data: updated }, { headers: CORS_HEADERS });
  }

  return withApiPermission(request, { system: ["manage"] }, async () => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const targetUrl = searchParams.get("url");
    const token = searchParams.get("token") || "";

    if (!id) {
      return NextResponse.json({ error: "Parameter id wajib diisi." }, { status: 400 });
    }
    featureMarkerIdSchema.parse(id);
    const body = await request.json().catch(() => ({}));
    const input = updateFeatureMarkerSchema.parse(body);

    if (targetUrl) {
      const cleanUrl = `${targetUrl.replace(/\/+$/, "")}/api/deploy/feature-markers?id=${encodeURIComponent(id)}`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (token) headers["x-monitor-token"] = token;

      const res = await fetch(cleanUrl, {
        method: "PATCH",
        headers,
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => null);
        return NextResponse.json(
          { error: errorJson?.error || `Proxy gagal: HTTP ${res.status}` },
          { status: res.status },
        );
      }
      const data = await res.json();
      return NextResponse.json(data);
    }

    const updated = await updateFeatureMarker(id, input);
    if (!updated) {
      return NextResponse.json({ error: "Tanda fitur tidak ditemukan." }, { status: 404 });
    }
    return NextResponse.json({ data: updated });
  });
}

export async function DELETE(request: NextRequest) {
  if (verifyMonitorToken(request)) {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Parameter id wajib diisi." }, { status: 400 });
    }
    featureMarkerIdSchema.parse(id);
    const deleted = await deleteFeatureMarker(id);
    if (!deleted) {
      return NextResponse.json({ error: "Tanda fitur tidak ditemukan." }, { status: 404 });
    }
    return NextResponse.json({ success: true }, { headers: CORS_HEADERS });
  }

  return withApiPermission(request, { system: ["manage"] }, async () => {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const targetUrl = searchParams.get("url");
    const token = searchParams.get("token") || "";

    if (!id) {
      return NextResponse.json({ error: "Parameter id wajib diisi." }, { status: 400 });
    }
    featureMarkerIdSchema.parse(id);

    if (targetUrl) {
      const cleanUrl = `${targetUrl.replace(/\/+$/, "")}/api/deploy/feature-markers?id=${encodeURIComponent(id)}`;
      const headers: Record<string, string> = { Accept: "application/json" };
      if (token) headers["x-monitor-token"] = token;

      const res = await fetch(cleanUrl, {
        method: "DELETE",
        headers,
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => null);
        return NextResponse.json(
          { error: errorJson?.error || `Proxy gagal: HTTP ${res.status}` },
          { status: res.status },
        );
      }
      return NextResponse.json({ success: true });
    }

    const deleted = await deleteFeatureMarker(id);
    if (!deleted) {
      return NextResponse.json({ error: "Tanda fitur tidak ditemukan." }, { status: 404 });
    }
    return NextResponse.json({ success: true, message: "Tanda fitur berhasil dihapus." });
  });
}
