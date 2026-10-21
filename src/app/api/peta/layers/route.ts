import { readJson, withApiPermission, withApiSession } from "@/lib/api";
import { MapDataAdapter } from "@/services/map/adapter";
import { z } from "zod";
import { layerFields } from "./schema";

export const runtime = "nodejs";

const createLayerSchema = z.object({
  name: layerFields.name,
  layerOrder: layerFields.layerOrder.optional(),
  opacity: layerFields.opacity.optional(),
  visible: layerFields.visible.optional(),
  shapes: layerFields.shapes,
});

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const data = await MapDataAdapter.getLayers();
    return Response.json({ data }, { status: 200 });
  });
}

export function POST(request: Request) {
  return withApiPermission(request, { map: ["manage"] }, async () => {
    const parsed = createLayerSchema.parse(await readJson(request));
    const layer = await MapDataAdapter.createLayer(parsed);
    return Response.json({ data: layer }, { status: 201 });
  });
}
