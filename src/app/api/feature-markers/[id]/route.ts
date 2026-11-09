import { ApiError, readJson, withApiSession } from "@/lib/api";
import { isDeveloper, isSuperAdmin } from "@/lib/roles";
import {
  deleteFeatureMarker,
  getFeatureMarkerById,
  updateFeatureMarker,
} from "@/services/feature-markers.service";
import {
  featureMarkerIdSchema,
  updateFeatureMarkerSchema,
} from "@/validators/feature-markers";

export const runtime = "nodejs";
export function GET(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async () => {
    const { id } = await props.params;
    featureMarkerIdSchema.parse(id);
    const marker = await getFeatureMarkerById(id);
    if (!marker) {
      throw new ApiError(404, "NOT_FOUND", "Tanda fitur tidak ditemukan.");
    }
    return Response.json({ data: marker });
  });
}

export function PATCH(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async (session) => {
    const role = session.user.role;
    if (!isDeveloper(role) && !isSuperAdmin(role)) {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Hanya developer atau superadmin yang dapat memperbarui tanda fitur.",
      );
    }

    const { id } = await props.params;
    featureMarkerIdSchema.parse(id);

    const body = await readJson(request);
    const input = updateFeatureMarkerSchema.parse(body);

    const updated = await updateFeatureMarker(id, input);
    if (!updated) {
      throw new ApiError(404, "NOT_FOUND", "Tanda fitur tidak ditemukan.");
    }

    return Response.json({ data: updated });
  });
}

export function DELETE(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async (session) => {
    const role = session.user.role;
    if (!isDeveloper(role) && !isSuperAdmin(role)) {
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Hanya developer atau superadmin yang dapat menghapus tanda fitur.",
      );
    }

    const { id } = await props.params;
    featureMarkerIdSchema.parse(id);

    const deleted = await deleteFeatureMarker(id);
    if (!deleted) {
      throw new ApiError(404, "NOT_FOUND", "Tanda fitur tidak ditemukan.");
    }

    return Response.json({
      success: true,
      message: "Tanda fitur berhasil dihapus.",
    });
  });
}
