import "server-only";
import { withApiSession } from "@/lib/api";
import { getGenieacsConfig, sanitizeGenieacsUrl } from "@/lib/genieacs/config";
import { getOntWebSettings } from "@/services/ont-web-settings.service";

export const runtime = "nodejs";

// Konfigurasi GenieACS yang benar-benar berlaku, untuk tab Konfigurasi: alamat NBI yang dipakai aplikasi (tanpa
// kredensial; sanitizeGenieacsUrl sudah membuangnya) dan ACS URL + periodic inform yang HARUS dituju modem
// (Pengaturan "Pasang GenieACS"). Tidak ada sandi di sini, jadi cukup login biasa.
export function GET(request: Request) {
  return withApiSession(request, async () => {
    const nbi = getGenieacsConfig();
    const settings = await getOntWebSettings();
    const uiUrl = process.env.GENIEACS_UI_URL?.trim();
    // Developer: NBI localhost dilayani container noc-tunnel-server. Hanya host-nya, tanpa nama pengguna SSH.
    const tunnelHost =
      process.env.GENIEACS_TUNNEL_TARGET?.split("@").pop()?.trim() || null;
    return Response.json(
      {
        ok: true,
        data: {
          mode: nbi.mode,
          nbiUrl: nbi.url,
          tunnelHost,
          uiUrl: uiUrl ? sanitizeGenieacsUrl(uiUrl) : null,
          acsConfigured: settings.configured,
          acsUrl: settings.configured ? settings.acsUrl : "",
          informInterval: settings.configured ? settings.informInterval : null,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
