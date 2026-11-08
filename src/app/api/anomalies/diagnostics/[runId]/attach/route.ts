import { readJson, withApiPermission } from "@/lib/api";
import { goDiagnostics } from "@/lib/diagnostics/go-backend";
import {
  attachDiagnosticSchema,
  diagnosticRunIdSchema,
} from "@/validators/diagnostics";

export const runtime = "nodejs";
type Context = { params: Promise<{ runId: string }> };

export function POST(request: Request, context: Context) {
  return withApiPermission(request, { alert: ["handle"] }, async (session) => {
    const runId = diagnosticRunIdSchema.parse((await context.params).runId);
    const { alertId } = attachDiagnosticSchema.parse(await readJson(request));
    const data = await goDiagnostics<{ ticketNotes: string }>(
      session.user.id,
      `/api/v1/diagnostics/${runId}/attach`,
      { method: "POST", body: JSON.stringify({ alertId }) },
      ["alert:handle"],
    );
    return Response.json({ data, ticketNotes: data.ticketNotes });
  });
}
