import { readJson, withApiSession } from "@/lib/api";
import {
  goDiagnostics,
  shapeRun,
  type GoRun,
} from "@/lib/diagnostics/go-backend";
import { startDiagnosticSchema } from "@/validators/diagnostics";

export const runtime = "nodejs";

// UI hanya memanggil Go. Tidak ada analisis/DB diagnosa di Next.
export function GET(request: Request) {
  return withApiSession(request, async (session) => {
    const params = new URL(request.url).searchParams;
    const query = new URLSearchParams();
    for (const key of ["customerId", "limit"]) {
      const value = params.get(key);
      if (value) query.set(key, value);
    }
    const runs = await goDiagnostics<GoRun[]>(
      session.user.id,
      `/api/v1/diagnostics${query.size ? `?${query}` : ""}`,
    );
    return Response.json({ data: runs.map((run) => shapeRun(run)) });
  });
}

export function POST(request: Request) {
  return withApiSession(request, async (session) => {
    const { customerId, complaintAt } = startDiagnosticSchema.parse(
      await readJson(request),
    );
    const result = await goDiagnostics<{ run: GoRun; reused: boolean }>(
      session.user.id,
      "/api/v1/diagnostics",
      {
        method: "POST",
        body: JSON.stringify({ customerId, complaintAt }),
      },
    );
    return Response.json(
      { data: shapeRun(result.run), reused: result.reused },
      { status: result.reused ? 200 : 202 },
    );
  });
}
