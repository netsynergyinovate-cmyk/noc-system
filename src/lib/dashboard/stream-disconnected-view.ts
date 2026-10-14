// Pesan galat saat aliran realtime terputus. Murni: tidak membaca store.
export type StreamDisconnectedInput = {
  connection: "connecting" | "live" | "disconnected";
  /** Detik epoch pesan terakhir, atau null bila belum ada. */
  lastUpdateAt: number | null;
  hasReconnect: boolean;
};

export type StreamDisconnectedView = {
  visible: boolean;
  title: string;
  description: string;
  lastUpdateText: string;
  retryHint: string;
  showRetryButton: boolean;
};

const clock = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function formatClockTime(epochSeconds: number): string {
  return clock.format(new Date(epochSeconds * 1000));
}

export function streamDisconnectedView(
  input: StreamDisconnectedInput,
): StreamDisconnectedView {
  if (input.connection !== "disconnected") {
    return {
      visible: false,
      title: "",
      description: "",
      lastUpdateText: "",
      retryHint: "",
      showRetryButton: false,
    };
  }
  return {
    visible: true,
    title: "Aliran data terputus",
    description:
      "Grafik traffic berhenti mengalir dan data perangkat mungkin tidak mutakhir.",
    lastUpdateText:
      input.lastUpdateAt !== null
        ? "Pembaruan terakhir: " + formatClockTime(input.lastUpdateAt)
        : "Belum ada data diterima",
    retryHint: "Mencoba menyambung kembali otomatis…",
    showRetryButton: input.hasReconnect,
  };
}
