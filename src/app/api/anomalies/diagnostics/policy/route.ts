import { readJson, withApiPermission, withApiSession } from "@/lib/api";
import { goDiagnostics } from "@/lib/diagnostics/go-backend";
import type { DiagnosticPolicyDto } from "@/lib/diagnostics";
import { diagnosticPolicySchema } from "@/validators/diagnostics";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async (session) => {
    const data = await goDiagnostics<DiagnosticPolicyDto>(
      session.user.id,
      "/api/v1/diagnostics/policy",
    );
    return Response.json({ data });
  });
}

export function PUT(request: Request) {
  return withApiPermission(
    request,
    { threshold: ["manage"] },
    async (session) => {
      const input = diagnosticPolicySchema.parse(await readJson(request));
      const data = await goDiagnostics<DiagnosticPolicyDto>(
        session.user.id,
        "/api/v1/diagnostics/policy",
        { method: "PUT", body: JSON.stringify(input) },
        ["threshold:manage"],
      );
      return Response.json({ data });
    },
  );
}
