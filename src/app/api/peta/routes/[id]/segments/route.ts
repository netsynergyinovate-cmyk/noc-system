import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { MapDataAdapter } from "@/services/map/adapter";
import { ClassifiedCentralApiError } from "@/services/map/types";
import { z } from "zod";
import { geometrySchema } from "../../schema";

export const runtime = "nodejs";

const idSchema = z.string().min(1, "ID rute wajib diisi");

const createSegmentSchema = z
  .object({
    fromDeviceId: z.string().min(1, "ID perangkat asal tidak valid"),
    toDeviceId: z.string().min(1, "ID perangkat tujuan tidak valid").optional(),
    customerId: z.string().min(1, "ID pelanggan tidak valid").optional(),
    geometry: geometrySchema,
  })
  // strict: length_m, sequence, dan jejak snapping dari klien ditolak, bukan diabaikan
  .strict();

export function POST(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  return withApiPermission(request, { map: ["manage"] }, async () => {
    const params = await props.params;
    const id = idSchema.parse(params.id);
    const body = await readJson(request);
    const parsed = createSegmentSchema.parse(body);

    try {
      const result = await MapDataAdapter.saveCableSegment({
        routeId: id,
        fromDeviceId: parsed.fromDeviceId,
        toDeviceId: parsed.toDeviceId,
        customerId: parsed.customerId,
        geometry: parsed.geometry,
      });

      return Response.json({ data: result }, { status: 201 });
    } catch (err: unknown) {
      if (err instanceof ClassifiedCentralApiError) {
        throw new ApiError(err.status, err.code, err.message);
      }
      throw err;
    }
  });
}
