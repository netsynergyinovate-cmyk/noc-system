import { NextRequest, NextResponse } from "next/server";
import { withApiPermission } from "@/lib/api";
import { evaluateDeployAccess, deployGuardResponse } from "@/lib/deploy/role-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = (request: NextRequest) => {
  const guard = evaluateDeployAccess(request);
  const denied = deployGuardResponse(guard);
  if (denied) return denied;

  return withApiPermission(request, { system: ["manage"] }, async (_session) => {
    const { searchParams } = new URL(request.url);
    const targetUrl = searchParams.get("url");
    const token = searchParams.get("token") || "";

    if (!targetUrl) {
      return NextResponse.json({ ok: false, error: "Parameter url wajib diisi." }, { status: 400 });
    }

    try {
      const cleanUrl = targetUrl.replace(/\/+$/, "") + "/api/deploy/server-status";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const headers: Record<string, string> = {
        Accept: "application/json",
      };
      if (token) {
        headers["x-monitor-token"] = token;
      }

      const res = await fetch(cleanUrl, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const errorJson = await res.json().catch(() => null);
        return NextResponse.json(
          {
            ok: false,
            error: errorJson?.error || `Server merespons kode HTTP ${res.status}`,
            status: res.status,
          },
          { status: res.status },
        );
      }

      const data = await res.json();
      return NextResponse.json(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, error: `Gagal menghubungi server: ${msg}` },
        { status: 502 },
      );
    }
  });
};
