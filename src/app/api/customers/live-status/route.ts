import { withApiSession } from "@/lib/api";
import { getCustomerLiveStatus } from "@/services/customer-live-status.service";

export const runtime = "nodejs";

// Data langsung per pelanggan (IP, uptime, Wi-Fi, redaman) untuk tabel Pelanggan; kunci = id pelanggan.
export function GET(request: Request) {
  return withApiSession(request, async (session) =>
    Response.json({
      ok: true,
      data: await getCustomerLiveStatus(session.user.id),
    }),
  );
}
