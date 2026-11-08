import "server-only";
import { and, eq, isNotNull } from "drizzle-orm";
import { withApiPermission } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { db } from "@/db";
import { customers, oltOnus } from "@/db/schema";
import { env } from "@/lib/env";
import { issueRealtimeTicket } from "@/lib/realtime-ticket";
import { oltIdSchema } from "@/validators/devices";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

const TIMEOUT_MS = 25_000;

function formatOnuName(custName: string, pppoeUsername?: string | null): string {
  const cleanName = custName.replace(/[^a-zA-Z0-9_\-\. ]/g, "").trim();
  let prefix = "";
  if (pppoeUsername) {
    const match = /^(\d{3,6})\b/.exec(pppoeUsername.trim());
    if (match) prefix = `${match[1]}-`;
  }
  const full = `${prefix}${cleanName}`.trim();
  return full.length > 32 ? full.slice(0, 32).trim() : full;
}

export function POST(request: Request, context: Context) {
  let target = "";
  const audit = withAudit({
    action: "cpe-changed",
    getTarget: () => target || new URL(request.url).pathname,
  });

  return withApiPermission(
    request,
    { cpe: ["manage"] },
    audit(request, async (session) => {
      const { id: rawId } = await context.params;
      const oltId = oltIdSchema.parse(rawId);
      target = `olt:${oltId} sync-names`;

      if (!env.BACKEND_INTERNAL_URL || !env.REALTIME_TOKEN_SECRET) {
        return Response.json(
          { error: { code: "BACKEND_UNAVAILABLE", message: "Backend belum dikonfigurasi." } },
          { status: 503 },
        );
      }

      // Ambil seluruh ONU yang sudah dipetakan ke pelanggan pada OLT ini
      const mapped = await db
        .select({
          id: oltOnus.id,
          pon: oltOnus.ponIndex,
          onu: oltOnus.onuIndex,
          currentDesc: oltOnus.description,
          custName: customers.name,
          pppoeUsername: customers.pppoeUsername,
        })
        .from(oltOnus)
        .innerJoin(customers, eq(oltOnus.customerId, customers.id))
        .where(and(eq(oltOnus.oltId, oltId), isNotNull(oltOnus.customerId)));

      if (mapped.length === 0) {
        return Response.json({
          ok: true,
          summary: { total: 0, updated: 0, skipped: 0, failed: 0 },
          message: "Tidak ada ONU yang terpetakan ke pelanggan pada OLT ini.",
        });
      }

      const { token } = issueRealtimeTicket({
        userId: session.user.id,
        secret: env.REALTIME_TOKEN_SECRET,
        perms: ["cpe:manage"],
      });

      let updated = 0;
      let skipped = 0;
      let failed = 0;

      for (const row of mapped) {
        const targetDesc = formatOnuName(row.custName, row.pppoeUsername);
        if (!targetDesc || row.currentDesc === targetDesc) {
          skipped++;
          continue;
        }

        try {
          const res = await fetch(
            `${env.BACKEND_INTERNAL_URL}/api/v1/olts/${encodeURIComponent(oltId)}/onus/${row.pon}/${row.onu}/description`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ description: targetDesc }),
              cache: "no-store",
              signal: AbortSignal.timeout(TIMEOUT_MS),
            },
          );

          if (res.ok) {
            const resBody = (await res.json().catch(() => null)) as { description?: string } | null;
            const savedDesc = resBody?.description ?? targetDesc;
            await db
              .update(oltOnus)
              .set({ description: savedDesc })
              .where(eq(oltOnus.id, row.id));
            updated++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      return Response.json({
        ok: true,
        summary: { total: mapped.length, updated, skipped, failed },
        message: `${updated} ONU berhasil dinamai di OLT, ${skipped} sudah sesuai, ${failed} gagal.`,
      });
    }),
  );
}
