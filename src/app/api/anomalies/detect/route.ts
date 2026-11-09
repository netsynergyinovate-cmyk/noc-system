import { withApiSession } from "@/lib/api";
import { detectAnomalies } from "@/services/anomalies.service";
import { detectAnomaliesQuerySchema } from "@/validators/anomalies";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const rawParams = Object.fromEntries(
      new URL(request.url).searchParams.entries(),
    );
    const query = detectAnomaliesQuerySchema.parse(rawParams);
    const data = await detectAnomalies(query);
    return Response.json({ success: true, data });
  });
}

export function POST(request: Request) {
  return withApiSession(request, async () => {
    const rawParams = Object.fromEntries(
      new URL(request.url).searchParams.entries(),
    );
    const query = detectAnomaliesQuerySchema.parse(rawParams);
    const data = await detectAnomalies(query);
    return Response.json({ success: true, data });
  });
}
