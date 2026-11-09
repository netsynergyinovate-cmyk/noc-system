import "server-only";
import { withApiPermission } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { env } from "@/lib/env";
import { issueRealtimeTicket } from "@/lib/realtime-ticket";
import { ontWebTr069Schema } from "@/validators/devices";

export const runtime = "nodejs";

const TIMEOUT_MS = 50_000; // backend membatasi sesi modem 45 dtk (ubah WAN: PPPoE sambung ulang)

type BackendBody = {
  ok?: boolean;
  changed?: boolean;
  informing?: boolean;
  host?: string;
  wanChanged?: boolean;
  wanNote?: string;
  message?: string;
  error?: string;
} | null;

// Pasang GenieACS lewat halaman web admin modem (tombol "Pasang via web ONT").
// Backend Go yang login ke modem (kredensial admin modem bawaan ada di server);
// di sini hanya: izin "cpe:manage", validasi masukan, tiket sekali pakai, dan
// pesan untuk petugas. Kata sandi dari petugas diteruskan apa adanya dan tidak
// pernah masuk log audit (withAudit hanya mencatat metode dan target).
export function POST(request: Request) {
  let target = "";
  const audit = withAudit({
    action: "cpe-changed",
    getTarget: () => target || new URL(request.url).pathname,
  });
  return withApiPermission(
    request,
    { cpe: ["manage"] },
    audit(request, async (session) => {
      const raw = await request.json().catch(() => null);
      const input = ontWebTr069Schema.parse(raw);
      target = `ont-web:${input.host ?? input.onuId}`;

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
        res = await fetch(`${env.BACKEND_INTERNAL_URL}/api/v1/ont-web/tr069`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
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

      const body = (await res.json().catch(() => null)) as BackendBody;
      if (res.status === 200 && body?.ok) {
        return Response.json({
          ok: true,
          changed: body.changed === true,
          informing: body.informing === true,
          host: typeof body.host === "string" ? body.host : null,
          wanChanged: body.wanChanged === true,
          wanNote: typeof body.wanNote === "string" ? body.wanNote : "",
          message: body.message ?? "TR-069 dipasang di modem.",
        });
      }
      // Pesan backend untuk kasus ini ditulis untuk petugas (tanpa rahasia), jadi
      // diteruskan; selain itu pesan umum.
      const passThrough = new Set([400, 409, 422, 423, 502, 503, 504]);
      const message =
        passThrough.has(res.status) &&
        typeof body?.message === "string" &&
        body.message
          ? body.message
          : "Gagal memasang TR-069 di modem.";
      return Response.json(
        { error: { code: body?.error ?? "ONT_WEB_FAILED", message } },
        { status: passThrough.has(res.status) ? res.status : 502 },
      );
    }),
  );
}
