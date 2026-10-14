// Liveness check untuk container Next.js. Sengaja tanpa auth dan tanpa akses
// database: hanya membuktikan proses web hidup. Tidak membocorkan data apa pun.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", timestamp: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
