import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { MapDataAdapter } from "@/services/map/adapter";
import { ClassifiedCentralApiError } from "@/services/map/types";
import { z } from "zod";
import { geometrySchema } from "../routes/schema";

export const runtime = "nodejs";

const createDeviceSchema = z
  .object({
    name: z.string().min(1, "Nama perangkat wajib diisi"),
    type: z.enum(["server", "odc", "odp", "pole"]),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    capacity: z.number().default(0),
    parentDeviceId: z.string().min(1).nullable().optional(),
    routeId: z.string().min(1).optional(),
    fromDeviceId: z.string().min(1).optional(),
    geometry: geometrySchema.optional(),
  })
  // Identitas jalur dulu: selain server/OLT, perangkat wajib masuk rantai jalur
  .refine((d) => d.type === "server" || d.routeId, {
    message: "Pilih jalur kabel lebih dulu untuk ODC/ODP/tiang.",
    path: ["routeId"],
  });

export function POST(request: Request) {
  return withApiPermission(request, { map: ["manage"] }, async () => {
    const body = await readJson(request);
    const parsed = createDeviceSchema.parse(body);

    try {
      const device = await MapDataAdapter.createDevice({
        name: parsed.name,
        type: parsed.type,
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        capacity: parsed.capacity,
        parentDeviceId: parsed.parentDeviceId || null,
        routeId: parsed.routeId,
        fromDeviceId: parsed.fromDeviceId,
        geometry: parsed.geometry,
      });

      return Response.json({ data: device }, { status: 201 });
    } catch (err: unknown) {
      if (err instanceof ClassifiedCentralApiError) {
        throw new ApiError(err.status, err.code, err.message);
      }
      throw err;
    }
  });
}
