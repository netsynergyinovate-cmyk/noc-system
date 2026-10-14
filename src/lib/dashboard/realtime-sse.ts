import { handleRealtimeMessage, type RealtimeWsOptions } from "./realtime-ws";
import type { ConnectionStatus } from "./types";

const EVENTS = ["snapshot", "delta", "alerts", "incidents", "ping"] as const;

// Klien SSE untuk /api/realtime/stream. EventSource menyambung ulang sendiri
// selama belum ditutup; bila ia menyerah (CLOSED), data tiruan dipakai.
export function connectRealtimeSse(opts: RealtimeWsOptions): {
  close: () => void;
} {
  let closed = false;
  let status: ConnectionStatus | null = null;
  const setStatus = (next: ConnectionStatus) => {
    if (closed || next === status) return;
    status = next;
    opts.onStatusChange(next);
  };

  setStatus("connecting");
  const es = new EventSource("/api/realtime/stream");
  for (const name of EVENTS) {
    es.addEventListener(name, (e) => {
      if (closed) return;
      const raw = (e as MessageEvent).data;
      // ping hanya menandakan koneksi hidup.
      if (name === "ping") return void setStatus("live");
      if (handleRealtimeMessage(raw, opts)) setStatus("live");
    });
  }
  es.onerror = () => {
    if (closed) return;
    setStatus("disconnected");
    if (es.readyState === 2 /* CLOSED */) opts.fallbackToMock?.();
  };

  return {
    close() {
      closed = true;
      es.close();
    },
  };
}
