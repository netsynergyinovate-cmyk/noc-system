import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { MapDataAdapter } from "@/services/map/adapter";
import { ClassifiedCentralApiError } from "@/services/map/types";
import { z } from "zod";
import { ROUTE_COLORS } from "@/components/peta/map-style";

export const runtime = "nodejs";

const createRouteSchema = z.object({
  code: z.string().min(1, "Kode jalur kabel wajib diisi"),
  name: z.string().min(1, "Nama jalur wajib diisi"),
  cableType: z.string().min(1, "Tipe kabel wajib diisi"),
  fiberCapacity: z.number().int().positive("Kapasitas serat harus lebih dari 0"),
  fromDeviceId: z.string().min(1, "ID perangkat asal tidak valid"),
  toDeviceId: z.string().min(1, "ID perangkat tujuan tidak valid").optional(),
  // Hanya palet jalur: kuning/merah/hijau dipesan untuk status sambungan (PRD)
  color: z
    .enum(ROUTE_COLORS.map((c) => c.value) as [string, ...string[]], {
      message: "Warna jalur tidak tersedia di palet.",
    })
    .optional(),
})
  // strict: total_length_m & sampling_interval_m diisi server, bukan klien
  .strict();

export function POST(request: Request) {
  return withApiPermission(request, { map: ["manage"] }, async () => {
    const body = await readJson(request);
    const parsed = createRouteSchema.parse(body);

    try {
      const route = await MapDataAdapter.createCableRoute({
        code: parsed.code,
        name: parsed.name,
        cableType: parsed.cableType,
        fiberCapacity: parsed.fiberCapacity,
        fromDeviceId: parsed.fromDeviceId,
        toDeviceId: parsed.toDeviceId,
        color: parsed.color,
      });

      return Response.json({ data: route }, { status: 201 });
    } catch (err: unknown) {
      if (err instanceof ClassifiedCentralApiError) {
        throw new ApiError(err.status, err.code, err.message);
      }
      throw err;
    }
  });
}
