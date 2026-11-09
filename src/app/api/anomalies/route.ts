import { readJson, withApiSession } from "@/lib/api";
import { createAnomaly, getAnomaliesList } from "@/services/anomalies.service";
import {
  createAnomalyInputSchema,
  parseAnomalyQuery,
} from "@/validators/anomalies";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const query = parseAnomalyQuery(new URL(request.url).searchParams);
    const data = await getAnomaliesList(query);
    return Response.json({ data });
  });
}

export function POST(request: Request) {
  return withApiSession(request, async () => {
    const raw = await readJson(request);
    const validated = createAnomalyInputSchema.parse(raw);
    const data = await createAnomaly(validated);
    return Response.json({ success: true, data }, { status: 201 });
  });
}
