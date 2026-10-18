import "server-only";
import { withApiPermission } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { getOntWebSettings, saveOntWebSettings } from "@/services/ont-web-settings.service";
import { ontWebSettingsSchema } from "@/validators/devices";

export const runtime = "nodejs";

// Pengaturan "Pasang GenieACS lewat web ONT" (alamat ACS + kredensial admin modem).
// Izin sama dengan aksi tulis ke modem: cpe:manage. Kata sandi hanya diterima,
// tidak pernah dikembalikan (hanya penanda "sudah ada").
export function GET(request: Request) {
  return withApiPermission(request, { cpe: ["manage"] }, async () =>
    Response.json(await getOntWebSettings(), { headers: { "Cache-Control": "no-store" } }),
  );
}

export function PUT(request: Request) {
  // Audit mencatat metode dan target saja, tidak pernah isi body (ada kata sandi).
  const audit = withAudit({ action: "cpe-changed", getTarget: () => "ont-web-settings" });
  return withApiPermission(
    request,
    { cpe: ["manage"] },
    audit(request, async (session) => {
      const raw = await request.json().catch(() => null);
      const input = ontWebSettingsSchema.parse(raw);
      const saved = await saveOntWebSettings(input, session.user.id);
      return Response.json(saved, { headers: { "Cache-Control": "no-store" } });
    }),
  );
}
