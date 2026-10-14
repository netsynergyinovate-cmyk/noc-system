import type { ConnectionStatus } from "./types";

export interface LiveStatusInput {
  connection: ConnectionStatus;
  latencyMs: number | null;
  isMockFallback: boolean;
  hasReconnect: boolean;
}

export interface LiveStatusView {
  label: string;
  dot: string;
  // Teks badge cadangan; null bila bukan data tiruan.
  fallbackBadge: string | null;
  // Teks latensi; hanya untuk WebSocket sungguhan yang sedang live.
  latency: string | null;
  showRetry: boolean;
}

const base = {
  connecting: { label: "Menghubungkan…", dot: "bg-warning" },
  live: { label: "Live", dot: "bg-success motion-safe:animate-pulse" },
  disconnected: { label: "Terputus", dot: "bg-destructive" },
} as const satisfies Record<ConnectionStatus, { label: string; dot: string }>;

// Satu tempat yang memutuskan apa yang tampil; komponen hanya menggambar.
export function liveStatusView(input: LiveStatusInput): LiveStatusView {
  const { label, dot } = base[input.connection];
  return {
    label,
    dot,
    fallbackBadge: input.isMockFallback ? "Cadangan (Mock)" : null,
    latency:
      input.connection === "live" &&
      !input.isMockFallback &&
      input.latencyMs !== null
        ? `${input.latencyMs} ms`
        : null,
    showRetry: input.connection === "disconnected" && input.hasReconnect,
  };
}
