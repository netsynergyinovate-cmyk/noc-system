import { withApiSession, ApiError } from "@/lib/api";
import { GenieAcsError } from "@/lib/genieacs/client";
import { getCpeDetail } from "@/services/cpe-detail.service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

// Rincian lengkap satu modem (tanpa sandi). Semua pengguna yang login boleh membaca,
// sama seperti daftar CPE. Sandi ada di ../secrets dengan izin dan jejak audit sendiri.
export function GET(request: Request, context: Context) {
  return withApiSession(request, async () => {
    const { id } = await context.params;
    try {
      const data = await getCpeDetail(id);
      if (!data) return Response.json({ error: "Perangkat CPE tidak ditemukan" }, { status: 404 });
      return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      if (err instanceof GenieAcsError) throw new ApiError(502, "GENIEACS_UNAVAILABLE", "GenieACS tidak dapat dihubungi.");
      throw err;
    }
  });
}
