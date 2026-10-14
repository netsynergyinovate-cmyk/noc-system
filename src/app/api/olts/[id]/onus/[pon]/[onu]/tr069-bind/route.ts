import "server-only";
import { withApiPermission } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { env } from "@/lib/env";
import { issueRealtimeTicket } from "@/lib/realtime-ticket";
import { oltIdSchema, ponIndexSchema } from "@/validators/devices";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string; pon: string; onu: string }> };

const TIMEOUT_MS = 25_000; // sesi telnet backend dibatasi 20 dtk + sisa jalan jaringan

// Mengikat SATU ONU ke profil TR-069 di OLT-nya (tombol "Daftarkan ke GenieACS").
// Satu-satunya aksi di aplikasi yang membuat backend Go MENULIS ke OLT lewat
// telnet. Diteruskan ke backend persis seperti sinkron billing manual
// (src/lib/billing-proxy.ts): tiket realtime sekali pakai dengan izin
// "cpe:manage", dibuat HANYA setelah withApiPermission meloloskan sesi ini.
export function POST(request: Request, context: Context) {
  // getTarget (withAudit) sinkron dan dipanggil SESUDAH handler selesai; path
  // params (async di Next.js ini) diurai di dalam handler dan ditaruh di sini
  // supaya getTarget tinggal membacanya.
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

      if (!env.BACKEND_URL || !env.REALTIME_TOKEN_SECRET) {
        return Response.json(
          {
            error: {
              code: "BACKEND_UNAVAILABLE",
              message: "Backend belum dikonfigurasi (REALTIME_TOKEN_SECRET kosong).",
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
          `${env.BACKEND_URL}/api/v1/olts/${encodeURIComponent(oltId)}/onus/${pon}/${onu}/tr069-bind`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            signal: AbortSignal.timeout(TIMEOUT_MS),
          },
        );
      } catch {
        return Response.json(
          { error: { code: "BACKEND_UNREACHABLE", message: "Backend tidak dapat dihubungi." } },
          { status: 502 },
        );
      }

      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        error?: string;
      } | null;

      if (res.status === 200) {
        return Response.json({ ok: true, message: body?.message ?? "ONU diikat ke profil TR-069." });
      }
      if (res.status === 404) {
        return Response.json(
          { error: { code: "OLT_NOT_FOUND", message: "OLT tidak ditemukan atau nonaktif." } },
          { status: 404 },
        );
      }
      if (res.status === 409) {
        return Response.json(
          {
            error: {
              code: "PROFILE_MISSING",
              message: "Profil TR-069 belum dibuat di OLT. Buat dulu lewat CLI OLT.",
            },
          },
          { status: 409 },
        );
      }
      if (res.status === 400) {
        return Response.json(
          { error: { code: "BAD_REQUEST", message: body?.message ?? "Permintaan tidak sah." } },
          { status: 400 },
        );
      }
      // 502 (ditolak OLT/gagal) dan selainnya: pesan umum, rincian hanya di log backend.
      return Response.json(
        { error: { code: "BIND_FAILED", message: "OLT menolak atau gagal mengikat ONU ini." } },
        { status: 502 },
      );
    }),
  );
}
