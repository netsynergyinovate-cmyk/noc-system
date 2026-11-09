import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { MapDataAdapter } from "@/services/map/adapter";
import { ClassifiedCentralApiError } from "@/services/map/types";
import { ROUTE_COLORS } from "@/components/peta/map-style";
import { z } from "zod";

export const runtime = "nodejs";

const idSchema = z.string().min(1, "ID jalur wajib diisi");

const updateRouteSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Nama jalur wajib diisi")
      .max(160)
      .optional(),
    // Hanya palet jalur: kuning/merah/hijau dipesan untuk status sambungan (PRD)
    color: z
      .enum(ROUTE_COLORS.map((c) => c.value) as [string, ...string[]], {
        message: "Warna jalur tidak tersedia di palet.",
      })
      .optional(),
    cableType: z
      .string()
      .trim()
      .min(1, "Tipe kabel wajib diisi")
      .max(64)
      .optional(),
    fiberCapacity: z
      .number()
      .int()
      .positive("Kapasitas serat harus lebih dari 0")
      .optional(),
    pon: z.number().int().positive("PON harus angka 1 ke atas").optional(),
  })
  .strict();

// Ubah identitas jalur (nama, warna, kabel, PON) dari panel jalur / OLT
export function PATCH(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  return withApiPermission(request, { map: ["manage"] }, async () => {
    const id = idSchema.parse((await props.params).id);
    const data = updateRouteSchema.parse(await readJson(request));
    try {
      const undoId = await MapDataAdapter.updateRoute(id, data);
      return Response.json({ success: true, undoId });
    } catch (err: unknown) {
      if (err instanceof ClassifiedCentralApiError) {
        throw new ApiError(err.status, err.code, err.message);
      }
      throw err;
    }
  });
}
