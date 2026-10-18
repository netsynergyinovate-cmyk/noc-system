import { withApiSession } from "@/lib/api";
import { getMapConfiguration } from "@/services/map-config.service";
import { getMapLegendMetadata } from "@/services/map-legend.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const url = new URL(request.url);
    const includeLegend =
      url.searchParams.get("includeLegend") === "true" ||
      url.searchParams.has("legend");

    const config = getMapConfiguration();
    const payload: Record<string, unknown> = { ...config };

    if (includeLegend) {
      payload.legend = getMapLegendMetadata();
    }

    return Response.json({
      success: true,
      data: payload,
    });
  });
}
