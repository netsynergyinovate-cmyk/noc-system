import "server-only";
import { withApiSession } from "@/lib/api";
import { getGenieacsConfig } from "@/lib/genieacs/config";
import { getOntWebSettings } from "@/services/ont-web-settings.service";

export const runtime = "nodejs";

// Konfigurasi GenieACS yang benar-benar berlaku, untuk tab Konfigurasi: alamat NBI yang dipakai aplikasi (tanpa
// kredensial; sanitizeGenieacsUrl sudah membuangnya) dan ACS URL + periodic inform yang HARUS dituju modem
// (Pengaturan "Pasang GenieACS"). Tidak ada sandi di sini, jadi cukup login biasa.
export function GET(request: Request) {
  return withApiSession(request, async () => {
    const nbi = getGenieacsConfig();
    const settings = await getOntWebSettings();
    return Response.json(
      {
        ok: true,
        data: {
          mode: nbi.mode,
          nbiUrl: nbi.url,
          acsConfigured: settings.configured,
          acsUrl: settings.configured ? settings.acsUrl : "",
          informInterval: settings.configured ? settings.informInterval : null,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
