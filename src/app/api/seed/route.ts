import { withApiPermission, withApiSession } from "@/lib/api";
import {
  getSeedDataStatus,
  runAllInitialSeeds,
} from "@/services/seed-data.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const status = await getSeedDataStatus();
    return Response.json({ data: status });
  });
}

export function POST(request: Request) {
  return withApiPermission(request, { system: ["manage"] }, async (session) => {
    const actor = session.user.name || session.user.email || "operator";
    const report = await runAllInitialSeeds(actor);
    return Response.json({ data: report });
  });
}
