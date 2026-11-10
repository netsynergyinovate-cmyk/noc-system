import { ApiError, withApiSession } from "@/lib/api";
import { hasPermission } from "@/lib/session";
import { env } from "@/lib/env";
import { issueRealtimeTicket, REALTIME_PERMS } from "@/lib/realtime-ticket";

export const runtime = "nodejs";

// Menerbitkan tiket singkat agar browser bisa membuka WebSocket dan memanggil
// REST di backend Go. Hanya untuk pengguna yang sedang login. POST (bukan GET)
// supaya withApiSession ikut memeriksa Origin: ini mengeluarkan kredensial.
//
// Tiket membawa izin akun (`perms`) supaya backend Go bisa menolak aksi yang
// mengubah data dari peran hanya-lihat tanpa menanyakan sesi Better Auth.
// Izin dihitung dari peran ASLI di database saat tiket diterbitkan (bukan dari
// peran tiruan "Lihat sebagai", yang hanya hidup di browser). Tiket berumur 60
// detik, jadi bila peran dicabut, izin di tiket yang sudah terbit masih
// berlaku paling lama 60 detik lagi.
export function POST(request: Request) {
  return withApiSession(request, async (session) => {
    if (!env.REALTIME_TOKEN_SECRET)
      throw new ApiError(
        503,
        "REALTIME_NOT_CONFIGURED",
        "Realtime is not configured. Run npm run setup, then restart.",
      );
    const granted = await Promise.all(
      Object.entries(REALTIME_PERMS).map(async ([perm, permissions]) => {
        const ok = await hasPermission(session.user.id, permissions);
        return ok ? perm : null;
      }),
    );
    const { token, expiresAt } = issueRealtimeTicket({
      userId: session.user.id,
      secret: env.REALTIME_TOKEN_SECRET,
      perms: granted.filter((perm): perm is string => perm !== null),
    });
    const backend = new URL(env.BACKEND_URL);
    const wsUrl = new URL("/ws", backend);
    wsUrl.protocol = backend.protocol === "https:" ? "wss:" : "ws:";
    return Response.json({
      data: {
        token,
        expiresAt,
        wsUrl: wsUrl.toString(),
        apiUrl: backend.origin,
      },
    });
  });
}
