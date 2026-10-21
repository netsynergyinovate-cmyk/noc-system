import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { MapDataAdapter } from "@/services/map/adapter";
import { ClassifiedCentralApiError } from "@/services/map/types";
import { z } from "zod";

export const runtime = "nodejs";

const idSchema = z.string().min(1, "ID perangkat wajib diisi");

// Satu perubahan per permintaan: keterangan, rasio splitter (null = kosongkan), atau jenis ODP/ODC
const updateDeviceSchema = z.union([
  z.object({ notes: z.string().trim().max(1000, "Keterangan maksimal 1000 karakter") }).strict(),
  z.object({ splitterRatio: z.number().int().nullable() }).strict(),
  z.object({ type: z.enum(["odp", "odc"]) }).strict(),
  z.object({ splitterTap: z.number().int().nullable() }).strict(),
  z.object({ centralOltId: z.string().min(1).nullable() }).strict(),
]);

export function PATCH(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  return withApiPermission(request, { map: ["manage"] }, async () => {
    const params = await props.params;
    const id = idSchema.parse(params.id);
    const parsed = updateDeviceSchema.parse(await readJson(request));

    try {
      const undoId =
        "notes" in parsed
          ? await MapDataAdapter.updateDeviceNotes(id, parsed.notes)
          : "type" in parsed
            ? await MapDataAdapter.setDeviceType(id, parsed.type)
            : "splitterTap" in parsed
              ? await MapDataAdapter.setSplitterTap(id, parsed.splitterTap)
              : "centralOltId" in parsed
                ? await MapDataAdapter.setCentralOlt(id, parsed.centralOltId)
                : await MapDataAdapter.setSplitterRatio(id, parsed.splitterRatio);
      return Response.json({ success: true, undoId }, { status: 200 });
    } catch (err: unknown) {
      if (err instanceof ClassifiedCentralApiError) {
        throw new ApiError(err.status, err.code, err.message);
      }
      throw err;
    }
  });
}

export function DELETE(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  return withApiPermission(request, { map: ["manage"] }, async () => {
    const params = await props.params;
    const id = idSchema.parse(params.id);

    try {
      const undoId = await MapDataAdapter.deleteDevice(id);
      return Response.json({ success: true, undoId }, { status: 200 });
    } catch (err: unknown) {
      if (err instanceof ClassifiedCentralApiError) {
        throw new ApiError(err.status, err.code, err.message);
      }
      throw err;
    }
  });
}
