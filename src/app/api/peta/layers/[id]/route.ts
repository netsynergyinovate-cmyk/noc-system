import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { MapDataAdapter } from "@/services/map/adapter";
import { LayerNotFoundError } from "@/services/map/types";
import { z } from "zod";
import { idSchema, layerFields } from "../schema";

export const runtime = "nodejs";

const updateLayerSchema = z
  .object({
    name: layerFields.name,
    layerOrder: layerFields.layerOrder,
    opacity: layerFields.opacity,
    visible: layerFields.visible,
    shapes: layerFields.shapes,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Tidak ada field untuk diubah");

function notFound(err: unknown): never {
  if (err instanceof LayerNotFoundError) {
    throw new ApiError(404, "NOT_FOUND", err.message);
  }
  throw err;
}

export function PUT(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  return withApiPermission(request, { map: ["manage"] }, async () => {
    const id = idSchema.parse((await props.params).id);
    const parsed = updateLayerSchema.parse(await readJson(request));
    try {
      const layer = await MapDataAdapter.updateLayer(id, parsed);
      return Response.json({ data: layer }, { status: 200 });
    } catch (err) {
      notFound(err);
    }
  });
}

export function DELETE(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  return withApiPermission(request, { map: ["manage"] }, async () => {
    const id = idSchema.parse((await props.params).id);
    try {
      const undoId = await MapDataAdapter.deleteLayer(id);
      return Response.json({ success: true, undoId }, { status: 200 });
    } catch (err) {
      notFound(err);
    }
  });
}
