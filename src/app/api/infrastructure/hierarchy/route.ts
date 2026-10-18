import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { getNetworkHierarchyData } from "@/services/network-hierarchy.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const url = new URL(request.url);
      const forceMock =
        url.searchParams.get("forceMock") === "true" ||
        url.searchParams.get("mode") === "mock";

      const data = await getNetworkHierarchyData({ forceMock });

      return NextResponse.json({
        ok: true,
        success: true,
        data,
      });
    } catch (err) {
      console.error("[GET INFRASTRUCTURE HIERARCHY ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}
