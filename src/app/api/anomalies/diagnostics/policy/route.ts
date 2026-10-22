import { readJson, withApiPermission, withApiSession } from "@/lib/api";
import {
  getDiagnosticPolicy,
  updateDiagnosticPolicy,
} from "@/services/diagnostics.service";
import { diagnosticPolicySchema } from "@/validators/diagnostics";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () =>
    Response.json({ data: await getDiagnosticPolicy() }),
  );
}

// Kebijakan pemicu otomatis mengatur beban ke router; izinnya sama dengan
// pengaturan ambang alert.
export function PUT(request: Request) {
  return withApiPermission(request, { threshold: ["manage"] }, async (session) => {
    const input = diagnosticPolicySchema.parse(await readJson(request));
    const data = await updateDiagnosticPolicy(
      input,
      session.user.name || session.user.email,
    );
    return Response.json({ data });
  });
}
