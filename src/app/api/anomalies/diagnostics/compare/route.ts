import { ApiError, withApiSession } from "@/lib/api";
import { compareDiagnosticRuns } from "@/services/diagnostics.service";
import { compareDiagnosticQuerySchema } from "@/validators/diagnostics";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const { before, after } = compareDiagnosticQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const comparison = await compareDiagnosticRuns(before, after);
    if (!comparison) {
      throw new ApiError(404, "NOT_FOUND", "Diagnosa tidak ditemukan.");
    }
    return Response.json({ data: comparison });
  });
}
