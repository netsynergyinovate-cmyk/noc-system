import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { saveCableWaypointsSchema } from "@/validators/cable-waypoints";
import { saveCableWaypoints } from "@/services/cable-map.service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withApiSession(request, async () => {
    try {
      const body = await request.json();
      const parsed = saveCableWaypointsSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Data titik belokan waypoints tidak valid",
            issues: parsed.error.issues,
          },
          { status: 400 },
        );
      }

      const result = await saveCableWaypoints(parsed.data);
      return NextResponse.json(result, { status: 200 });
    } catch (error) {
      console.error("[POST_CABLE_WAYPOINTS_API_ERROR]", error);
      return NextResponse.json(
        { error: "Gagal menyimpan titik belokan jalur kabel" },
        { status: 500 },
      );
    }
  });
}
