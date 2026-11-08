import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withApiPermission } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { db } from "@/db";
import { oltOnus } from "@/db/schema";
import { env } from "@/lib/env";
import { issueRealtimeTicket } from "@/lib/realtime-ticket";
import { oltIdSchema, ponIndexSchema } from "@/validators/devices";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; pon: string; onu: string }> };

const TIMEOUT_MS = 25_000;

const descBodySchema = z.object({
  description: z.string().trim().min(1).max(32),
});

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
      const raw = await context.params;
      const oltId = oltIdSchema.parse(raw.id);
      const pon = ponIndexSchema.parse(raw.pon);
      const onu = ponIndexSchema.parse(raw.onu);
      target = `olt:${oltId} onu:${pon}/${onu}`;

      let bodyJson: unknown;
      try {
        bodyJson = await request.json();
      } catch {
        return Response.json({ error: { code: "BAD_REQUEST", message: "Body JSON tidak sah." } }, { status: 400 });
      }

      const parsed = descBodySchema.safeParse(bodyJson);
      if (!parsed.success) {
        return Response.json({ error: { code: "BAD_REQUEST", message: "Deskripsi harus 1-32 karakter." } }, { status: 400 });
      }
      const description = parsed.data.description;

      if (!env.BACKEND_INTERNAL_URL || !env.REALTIME_TOKEN_SECRET) {
        return Response.json(
          { error: { code: "BACKEND_UNAVAILABLE", message: "Backend belum dikonfigurasi (REALTIME_TOKEN_SECRET kosong)." } },
          { status: 503 },
        );
      }

      const { token } = issueRealtimeTicket({
        userId: session.user.id,
        secret: env.REALTIME_TOKEN_SECRET,
        perms: ["cpe:manage"],
      });

      let res: Response;
      try {
        res = await fetch(
          `${env.BACKEND_INTERNAL_URL}/api/v1/olts/${encodeURIComponent(oltId)}/onus/${pon}/${onu}/description`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ description }),
            cache: "no-store",
            signal: AbortSignal.timeout(TIMEOUT_MS),
          },
        );
      } catch {
        return Response.json(
          { error: { code: "BACKEND_UNREACHABLE", message: "Backend Go tidak dapat dihubungi." } },
          { status: 502 },
        );
      }

      const body: { ok?: boolean; message?: string; description?: string } | null = await res.json().catch(() => null);

      if (res.status === 200) {
        const finalDesc = body?.description ?? description;
        // Sinkronkan ke database lokal persis dengan yang diterima dan disimpan OLT
        try {
          await db
            .update(oltOnus)
            .set({ description: finalDesc })
            .where(and(eq(oltOnus.oltId, oltId), eq(oltOnus.ponIndex, pon), eq(oltOnus.onuIndex, onu)));
        } catch (dbErr) {
          console.error("Gagal sinkron nama ONU ke DB:", dbErr);
        }

        return Response.json({
          ok: true,
          message: body?.message ?? `Nama ONU ${pon}/${onu} berhasil disetel menjadi "${finalDesc}".`,
          description: finalDesc,
        });
      }

      if (res.status === 404) {
        return Response.json({ error: { code: "OLT_NOT_FOUND", message: "OLT tidak ditemukan atau nonaktif." } }, { status: 404 });
      }
      if (res.status === 400) {
        return Response.json({ error: { code: "BAD_REQUEST", message: body?.message ?? "Permintaan tidak sah." } }, { status: 400 });
      }

      return Response.json(
        { error: { code: "DESCRIPTION_FAILED", message: body?.message ?? "OLT menolak atau gagal mengubah deskripsi ONU ini." } },
        { status: 502 },
      );
    }),
  );
}
