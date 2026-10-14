import { isBenchmarkAuthorized } from "@/lib/benchmark/auth";
import { auditMockUsage } from "@/lib/dashboard/stack-benchmark";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isBenchmarkAuthorized(request))) {
    return Response.json({ error: "Tidak diizinkan." }, { status: 401 });
  }
  return Response.json(auditMockUsage());
}
