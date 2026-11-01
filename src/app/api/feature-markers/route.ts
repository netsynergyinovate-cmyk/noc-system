import { readJson, withApiSession } from "@/lib/api";
import {
  createFeatureMarker,
  getFeatureMarkerStats,
  listFeatureMarkers,
} from "@/services/feature-markers.service";
import {
  createFeatureMarkerSchema,
  listFeatureMarkersSchema,
} from "@/validators/feature-markers";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const url = new URL(request.url);
    const query = listFeatureMarkersSchema.parse(
      Object.fromEntries(url.searchParams),
    );

    const [markersResult, stats] = await Promise.all([
      listFeatureMarkers(query),
      getFeatureMarkerStats(),
    ]);

    return Response.json({
      data: markersResult.data,
      meta: markersResult.meta,
      stats,
    });
  });
}

export function POST(request: Request) {
  return withApiSession(request, async (session) => {
    const body = await readJson(request);
    const input = createFeatureMarkerSchema.parse(body);

    const marker = await createFeatureMarker(
      {
        id: session.user.id,
        email: session.user.email,
        role: session.user.role || "user",
      },
      input,
    );

    return Response.json(
      { data: marker },
      { status: 201, headers: { Location: `/api/feature-markers/${marker.id}` } },
    );
  });
}
