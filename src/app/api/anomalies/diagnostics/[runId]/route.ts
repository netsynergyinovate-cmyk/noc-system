import { ApiError, withApiSession } from "@/lib/api";
import { getDiagnosticRun } from "@/services/diagnostics.service";
import { diagnosticRunIdSchema } from "@/validators/diagnostics";

export const runtime = "nodejs";
type Context = { params: Promise<{ runId: string }> };

export function GET(request: Request, context: Context) {
  return withApiSession(request, async () => {
    const id = diagnosticRunIdSchema.parse((await context.params).runId);
    const data = await getDiagnosticRun(id);
    if (!data) throw new ApiError(404, "NOT_FOUND", "Diagnosa tidak ditemukan.");
    return Response.json({ data });
  });
}
