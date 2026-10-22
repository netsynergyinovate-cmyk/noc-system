import { ApiError, readJson, withApiSession } from "@/lib/api";
import {
  listDiagnosticRuns,
  startManualDiagnostic,
} from "@/services/diagnostics.service";
import {
  diagnosticListQuerySchema,
  startDiagnosticSchema,
} from "@/validators/diagnostics";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const query = diagnosticListQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return Response.json({ data: await listDiagnosticRuns(query) });
  });
}

// Diagnosa hanya membaca perangkat, jadi setiap sesi login boleh memintanya.
export function POST(request: Request) {
  return withApiSession(request, async (session) => {
    const { customerId } = startDiagnosticSchema.parse(await readJson(request));
    const result = await startManualDiagnostic(customerId, {
      id: session.user.id,
      name: session.user.name || session.user.email,
    });
    if (!result)
      throw new ApiError(404, "NOT_FOUND", "Pelanggan tidak ditemukan.");
    return Response.json(
      { data: result.run, reused: result.reused },
      { status: result.reused ? 200 : 202 },
    );
  });
}
