import { withApiSession } from "@/lib/api";
import {
  getWhatsappLogSummary,
  listWhatsappLogs,
} from "@/services/whatsapp.service";
import { listWhatsappLogsSchema } from "@/validators/whatsapp";

export const runtime = "nodejs";

// POST = kirim + catat log baru; sama persis dengan /api/whatsapp/send.
export { POST } from "../send/route";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const params = listWhatsappLogsSchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const [{ logs, total }, summary] = await Promise.all([
      listWhatsappLogs(params),
      getWhatsappLogSummary(),
    ]);
    return Response.json({ data: { logs, total, summary } });
  });
}
