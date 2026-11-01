import { readJson, withApiPermission } from "@/lib/api";
import { attachDiagnosticToAlert } from "@/services/diagnostics.service";
import {
  attachDiagnosticSchema,
  diagnosticRunIdSchema,
} from "@/validators/diagnostics";

export const runtime = "nodejs";
type Context = { params: Promise<{ runId: string }> };

export function POST(request: Request, context: Context) {
  return withApiPermission(request, { alert: ["handle"] }, async (session) => {
    const runId = diagnosticRunIdSchema.parse((await context.params).runId);
    const body = await readJson(request);
    const { alertId } = attachDiagnosticSchema.parse(body);
    const userName = session.user.name || session.user.email || "Operator";
    const ticketNotes = await attachDiagnosticToAlert(runId, alertId, userName);
    return Response.json({ data: { ticketNotes }, ticketNotes });
  });
}
