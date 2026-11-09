import { z } from "zod";
import { withApiPermission } from "@/lib/api";
import { auditQuerySchema } from "@/lib/audit-query";
import { toCsv } from "@/lib/csv-export";
import { listAuditLogs } from "@/services/audit.service";

export const runtime = "nodejs";

const EXPORT_MAX = 5000;
const exportSchema = auditQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(EXPORT_MAX).default(EXPORT_MAX),
});

export function GET(request: Request) {
  return withApiPermission(request, { audit: ["read"] }, async () => {
    const raw: Record<string, string> = {};
    for (const [key, value] of new URL(request.url).searchParams) {
      if (value.trim() !== "") raw[key] = value;
    }
    const options = exportSchema.parse(raw);
    const entries = await listAuditLogs(options, EXPORT_MAX);

    const csv = toCsv(
      ["Waktu", "Aksi", "Target", "Aktor", "Detail"],
      entries.map((e) => [
        e.createdAt.toISOString(),
        e.action,
        e.target,
        e.actorName
          ? `${e.actorName} <${e.actorEmail}>`
          : (e.actorEmail ?? "Sistem"),
        JSON.stringify(e.detail ?? {}),
      ]),
    );

    return new Response(`\uFEFF${csv}`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-log-${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
