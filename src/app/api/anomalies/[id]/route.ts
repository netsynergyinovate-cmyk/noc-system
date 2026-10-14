import { readJson, withApiSession } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import {
  getAnomalyById,
  updateAnomalyStatus,
} from "@/services/anomalies.service";
import { updateAnomalyStatusSchema } from "@/validators/anomalies";

export const runtime = "nodejs";

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async () => {
    const { id } = await params;
    const data = await getAnomalyById(id);
    return Response.json({ data });
  });
}

export function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const audit = withAudit({
    action: "alert-handled",
    getTarget: () => "/api/anomalies",
  });
  return withApiSession(
    request,
    audit(request, async (session) => {
      const { id } = await params;
      const raw = await readJson(request);
      const validated = updateAnomalyStatusSchema.parse(raw);
      const operator =
        validated.operator ||
        session.user.name ||
        session.user.email ||
        "Operator";
      const data = await updateAnomalyStatus(id, { ...validated, operator });
      return Response.json({ success: true, data });
    }),
  );
}

export function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return PATCH(request, { params });
}
