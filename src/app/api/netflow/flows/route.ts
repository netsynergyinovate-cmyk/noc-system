import { readJson, withApiSession } from "@/lib/api";
import { getTopFlows, ingestNetflowFlows, type IngestFlowInput } from "@/services/netflow.service";
import { parseNetflowQuery } from "@/validators/netflow";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const parsed = parseNetflowQuery(new URL(request.url).searchParams);
    return Response.json({ data: await getTopFlows(parsed) });
  });
}

export function POST(request: Request) {
  return withApiSession(request, async () => {
    const raw = await readJson(request);
    const body = raw as Record<string, unknown> | unknown[] | null;
    const flows: IngestFlowInput[] = Array.isArray(body)
      ? (body as IngestFlowInput[])
      : body && typeof body === "object" && "flows" in body && Array.isArray(body.flows)
        ? (body.flows as IngestFlowInput[])
        : body && typeof body === "object"
          ? [body as unknown as IngestFlowInput]
          : [];
    const result = await ingestNetflowFlows(flows);
    return Response.json({ success: true, data: result });
  });
}
