import { ApiError, readJson, withApiPermission, withApiSession } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import {
  getThresholds,
  resetThresholds,
  ThresholdValidationError,
  updateThresholds,
} from "@/services/thresholds.service";
import { updateThresholdsSchema } from "@/validators/thresholds";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () =>
    Response.json({ data: await getThresholds() }),
  );
}

export function PUT(request: Request) {
  const audit = withAudit({ action: "threshold-changed", getTarget: () => "/api/thresholds" });
  return withApiPermission(request, { threshold: ["manage"] }, audit(request, async (session) => {
    const input = updateThresholdsSchema.parse(await readJson(request));
    try {
      const updated = await updateThresholds(
        input as Parameters<typeof updateThresholds>[0],
        session.user.id,
      );
      return Response.json({ data: updated });
    } catch (error) {
      if (error instanceof ThresholdValidationError)
        throw new ApiError(422, "VALIDATION_ERROR", error.message);
      throw error;
    }
  }));
}

export function DELETE(request: Request) {
  const audit = withAudit({ action: "threshold-reset", getTarget: () => "/api/thresholds" });
  return withApiPermission(request, { threshold: ["manage"] }, audit(request, async (session) =>
    Response.json({ data: await resetThresholds(session.user.id) }),
  ));
}

