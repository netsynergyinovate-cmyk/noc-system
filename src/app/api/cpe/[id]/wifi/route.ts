import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { WifiChangeError } from "@/lib/genieacs/device-detail";
import { changeDeviceWifi, WifiChangeFailed } from "@/services/cpe-detail.service";
import { changeDeviceWifiSchema } from "@/validators/cpe";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

// Ubah nama Wi-Fi (SSID) dan/atau sandinya di satu modem lewat TR-069. Izin "cpe:manage".
// Audit mencatat modem, nomor SSID dan FIELD yang diubah, tidak pernah SSID baru maupun sandinya.
export function POST(request: Request, context: Context) {
  let target = "";
  const audit = withAudit({
    action: "cpe-changed",
    getTarget: () => target || new URL(request.url).pathname,
  });
  return withApiPermission(
    request,
    { cpe: ["manage"] },
    audit(request, async () => {
      const { id } = await context.params;
      const input = changeDeviceWifiSchema.parse(await readJson(request));
      const fields = [input.ssid !== undefined ? "ssid" : null, input.password !== undefined ? "sandi" : null].filter(Boolean);
      target = `cpe:${id} wifi#${input.index} (${fields.join("+")})`;

      try {
        const result = await changeDeviceWifi(id, input);
        if (!result) return Response.json({ error: "Perangkat CPE tidak ditemukan" }, { status: 404 });
        return Response.json(
          {
            ok: true,
            status: result.status,
            verified: result.verified,
            message: result.message,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch (err) {
        if (err instanceof WifiChangeError) {
          throw new ApiError(err.code === "WLAN_NOT_FOUND" ? 404 : 422, err.code, err.message);
        }
        if (err instanceof WifiChangeFailed) {
          // 504 dari NBI = modem tidak menjawab connection request (kemungkinan offline).
          throw new ApiError(err.httpStatus === 504 ? 504 : 502, "WIFI_CHANGE_FAILED", err.message);
        }
        throw err;
      }
    }),
  );
}
