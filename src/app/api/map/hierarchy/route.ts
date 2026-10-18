import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { getNetworkHierarchyData } from "@/services/network-hierarchy.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const data = await getNetworkHierarchyData();

      return NextResponse.json({
        ok: true,
        success: true,
        data,
      });
    } catch (err) {
      console.error("[GET MAP HIERARCHY ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}
