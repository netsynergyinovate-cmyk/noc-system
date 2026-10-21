import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { MapDataAdapter } from "@/services/map/adapter";
import { ClassifiedCentralApiError } from "@/services/map/types";
import { z } from "zod";

export const runtime = "nodejs";

const idSchema = z.string().min(1, "ID pelanggan wajib diisi");

// port null = lepas pelanggan dari port ODP
const portSchema = z.object({
  port: z.number().int().min(1, "Nomor port mulai dari 1").max(512).nullable(),
});

export function PUT(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  return withApiPermission(request, { map: ["manage"] }, async () => {
    const id = idSchema.parse((await props.params).id);
    const { port } = portSchema.parse(await readJson(request));
    try {
      const undoId = await MapDataAdapter.setParentPort("customer", id, port);
      return Response.json({ success: true, undoId }, { status: 200 });
    } catch (err: unknown) {
      if (err instanceof ClassifiedCentralApiError) {
        throw new ApiError(err.status, err.code, err.message);
      }
      throw err;
    }
  });
}
