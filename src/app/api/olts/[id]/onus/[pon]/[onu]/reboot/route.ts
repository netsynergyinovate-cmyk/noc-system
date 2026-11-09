import "server-only";
import { withApiPermission } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { env } from "@/lib/env";
import { issueRealtimeTicket } from "@/lib/realtime-ticket";
import { oltIdSchema, ponIndexSchema } from "@/validators/devices";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; pon: string; onu: string }> };

const TIMEOUT_MS = 25_000; // sesi telnet backend dibatasi 20 dtk + sisa jalan jaringan

// Me-reboot SATU ONU lewat CLI OLT-nya (onu-reboot onu-id N), untuk modem yang tidak bisa dijangkau GenieACS.
// Diteruskan ke backend Go seperti tr069-bind: tiket sekali pakai dengan izin "cpe:manage", dibuat HANYA setelah
// withApiPermission meloloskan sesi ini. Setiap pemakaian tercatat di audit_log (siapa, OLT mana, ONU berapa).
export function POST(request: Request, context: Context) {
  let target = "";
  const audit = withAudit({
    action: "cpe-changed", // aksi audit terdaftar; target "olt:… onu:p/o" membedakannya dari ikat TR-069
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

      if (!env.BACKEND_INTERNAL_URL || !env.REALTIME_TOKEN_SECRET) {
        return Response.json(
          {
            error: {
              code: "BACKEND_UNAVAILABLE",
              message:
                "Backend belum dikonfigurasi (REALTIME_TOKEN_SECRET kosong).",
            },
          },
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
          `${env.BACKEND_INTERNAL_URL}/api/v1/olts/${encodeURIComponent(oltId)}/onus/${pon}/${onu}/reboot`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            signal: AbortSignal.timeout(TIMEOUT_MS),
          },
        );
      } catch {
        return Response.json(
          {
            error: {
              code: "BACKEND_UNREACHABLE",
              message: "Backend tidak dapat dihubungi.",
            },
          },
          { status: 502 },
        );
      }

      const body: { message?: string } | null = await res
        .json()
        .catch(() => null);

      if (res.status === 200) {
        return Response.json({
          ok: true,
          message: body?.message ?? "Perintah reboot diterima OLT.",
        });
      }
      if (res.status === 404) {
        return Response.json(
          {
            error: {
              code: "OLT_NOT_FOUND",
              message: "OLT tidak ditemukan atau nonaktif.",
            },
          },
          { status: 404 },
        );
      }
      if (res.status === 429) {
        return Response.json(
          {
            error: {
              code: "REBOOT_COOLDOWN",
              message:
                body?.message ??
                "ONU ini baru saja di-reboot; tunggu sekitar 1 menit.",
            },
          },
          { status: 429 },
        );
      }
      if (res.status === 400) {
        return Response.json(
          {
            error: {
              code: "BAD_REQUEST",
              message: body?.message ?? "Permintaan tidak sah.",
            },
          },
          { status: 400 },
        );
      }
      // 502 (ditolak OLT/gagal) dan selainnya: pesan umum, rincian hanya di log backend.
      return Response.json(
        {
          error: {
            code: "REBOOT_FAILED",
            message: "OLT menolak atau gagal me-reboot ONU ini.",
          },
        },
        { status: 502 },
      );
    }),
  );
}
