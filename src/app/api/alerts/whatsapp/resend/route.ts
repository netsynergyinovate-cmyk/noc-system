import { withApiPermission } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { retryFailedWhatsappLogs } from "@/services/whatsapp.service";

export const runtime = "nodejs";

export function POST(request: Request) {
  const audit = withAudit({
    action: "whatsapp-logs-retried",
    getTarget: () => "/api/alerts/whatsapp/resend",
  });
  return withApiPermission(
    request,
    { threshold: ["manage"] },
    audit(request, async () => {
      const data = await retryFailedWhatsappLogs();
      return Response.json({ ok: true, data });
    }),
  );
}
