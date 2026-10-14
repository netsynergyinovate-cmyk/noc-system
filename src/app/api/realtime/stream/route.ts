import { auth } from "@/lib/auth";
import { mockActiveAlerts } from "@/lib/dashboard/alerts";
import { buildIncidentCards } from "@/lib/dashboard/incident-cards";
import { createMockCustomers } from "@/lib/dashboard/mock-data";
import { createMockFeed } from "@/lib/dashboard/mock-feed";
import { formatSseEvent } from "@/lib/dashboard/sse-format";

export const runtime = "nodejs";

const TICK_MS = 1000;
const PING_EVERY_TICKS = 15;

// Siaran realtime lewat SSE untuk klien yang tak bisa memakai WebSocket Go.
// Bentuk pesan sama dengan hub (lihat handleRealtimeMessage): kolom `type` dan
// `time` (detik epoch) ada di dalam data.
// ponytail: sumber data masih tiruan (mockActiveAlerts + createMockFeed); ganti
// dengan getAlertsList({ status: "active" }) saat tabel alerts memuat sumber
// akar/dampak yang sama dengan ActiveAlert.
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      { error: "unauthorized", message: "Sesi login diperlukan." },
      { status: 401 },
    );

  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        try {
          controller.enqueue(enc.encode(formatSseEvent(event, data)));
        } catch {
          stop(); // stream sudah ditutup klien
        }
      };
      const nowSec = () => Math.floor(Date.now() / 1000);
      const feed = createMockFeed(createMockCustomers());
      let lastAlerts = "";
      const pushAlerts = (time: number) => {
        const active = mockActiveAlerts(time);
        const sig = JSON.stringify(active);
        if (sig === lastAlerts) return;
        lastAlerts = sig;
        send("alerts", { type: "alerts", time, active, ended: [] });
        send("incidents", {
          type: "incidents",
          time,
          cards: buildIncidentCards(active),
        });
      };

      const t0 = nowSec();
      send("snapshot", { type: "snapshot", time: t0, ...feed.snapshot(t0) });
      pushAlerts(t0);

      let ticks = 0;
      timer = setInterval(() => {
        const time = nowSec();
        send("delta", { type: "delta", time, ...feed.next(time) });
        pushAlerts(time);
        if (++ticks % PING_EVERY_TICKS === 0)
          send("ping", { type: "ping", time });
      }, TICK_MS);
      request.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel: stop,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
