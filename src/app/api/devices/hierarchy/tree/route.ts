import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { getDeviceHierarchyTree } from "@/services/device-relations.service";

export async function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const url = new URL(request.url);
      const rootId = url.searchParams.get("rootId") || undefined;

      const tree = await getDeviceHierarchyTree(rootId);

      return NextResponse.json({
        data: tree,
        totalRoots: tree.length,
      });
    } catch (error) {
      console.error("[GET_DEVICE_HIERARCHY_TREE_ERROR]", error);
      return NextResponse.json(
        {
          error: "Gagal memuat pohon hierarki perangkat.",
          message: error instanceof Error ? error.message : "Internal Server Error",
        },
        { status: 500 },
      );
    }
  });
}
