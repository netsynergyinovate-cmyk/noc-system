import { withApiPermission, ApiError } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { GenieAcsError } from "@/lib/genieacs/client";
import { getCpeSecrets } from "@/services/cpe-detail.service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

// Sandi Wi-Fi dan admin web modem. Memuat rahasia ASLI, jadi: izin "cpe:manage"
// (admin), tidak pernah di-cache, dan SETIAP pembukaan dicatat di audit_log
// (siapa, modem mana; isi sandi tidak pernah ikut tercatat).
export function GET(request: Request, context: Context) {
  let target = "";
  const audit = withAudit({
    action: "cpe-secret-viewed",
    getTarget: () => target || new URL(request.url).pathname,
  });
  return withApiPermission(
    request,
    { cpe: ["manage"] },
    audit(request, async () => {
      const { id } = await context.params;
      const wifiOnly = new URL(request.url).searchParams.get("scope") === "wifi";
      target = `cpe:${id}${wifiOnly ? " (wifi)" : ""}`;
      try {
        const found = await getCpeSecrets(id);
        if (!found) return Response.json({ error: "Perangkat CPE tidak ditemukan" }, { status: 404 });
        target = `cpe:${found.deviceId}${wifiOnly ? " (wifi)" : ""}`;
        // scope=wifi: hanya sandi Wi-Fi; akun admin web modem dan akun ACS tidak ikut ke peramban.
        return Response.json(
          { data: wifiOnly ? { wifi: found.secrets.wifi } : found.secrets },
          { headers: { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" } },
        );
      } catch (err) {
        if (err instanceof GenieAcsError) throw new ApiError(502, "GENIEACS_UNAVAILABLE", "GenieACS tidak dapat dihubungi.");
        throw err;
      }
    }),
  );
}
