import type { AlertsMessage } from "./alert-sync";
import type { IncidentCard } from "./incident-cards";
import type {
  ConnectionStatus,
  DashboardDelta,
  DashboardSnapshot,
} from "./types";
import type { Telemetry } from "./telemetry";

export const RECONNECT_MS = 3000;

// Nama sinyal window yang dikirim saat pesan "events" tiba dari hub.
export const ALERT_EVENTS_SIGNAL = "noc:alert-events";

export interface RealtimeWsOptions {
  onSnapshot: (snapshot: DashboardSnapshot, time: number) => void;
  onDelta: (delta: DashboardDelta, time: number) => void;
  onAlerts?: (alerts: AlertsMessage, time: number) => void;
  onIncidents?: (cards: IncidentCard[], time: number) => void;
  onTelemetry?: (telemetry: Telemetry) => void;
  onStatusChange: (status: ConnectionStatus) => void;
  // Dipanggil saat tiket gagal diambil, supaya pemanggil bisa memakai data tiruan.
  fallbackToMock?: () => void;
}

export const authPayload = (token: string) =>
  JSON.stringify({ type: "auth", token });

// Mengubah satu pesan hub menjadi panggilan callback. Mengembalikan true bila
// pesan membuat koneksi dianggap hidup. Pesan rusak/tak dikenal diabaikan.
export function handleRealtimeMessage(
  raw: unknown,
  opts: Pick<
    RealtimeWsOptions,
    "onSnapshot" | "onDelta" | "onAlerts" | "onIncidents" | "onTelemetry"
  >,
): boolean {
  let msg: any;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return false;
  }
  // Gangguan mulai atau selesai di rule engine Go. Pesan ini TIDAK membawa `time`
  // (hanya daftar event), jadi diperiksa sebelum syarat itu. Isinya tidak dipakai
  // langsung: daftar alert dibaca ulang dari database (yang sudah memuat event
  // ini), jadi cukup memberi tahu penyinkron alert agar segera memuat.
  if (
    msg &&
    typeof msg === "object" &&
    (msg.type === "events" || msg.type === "anomaly_event" || msg.event === "anomaly")
  ) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(ALERT_EVENTS_SIGNAL));
    }
    return true;
  }
  // Telemetri tidak membawa `time`: hub hanya mengirimnya saat isinya berubah.
  if (msg && typeof msg === "object" && msg.type === "telemetry" && msg.data) {
    opts.onTelemetry?.(msg.data);
    return true;
  }
  if (!msg || typeof msg !== "object" || typeof msg.time !== "number")
    return false;
  if (msg.type === "snapshot") {
    opts.onSnapshot(msg, msg.time);
    // Tiap (re)connect: event gangguan yang terlewat saat putus dibaca ulang dari database.
    if (typeof window !== "undefined") window.dispatchEvent(new Event(ALERT_EVENTS_SIGNAL));
    return true;
  }
  if (msg.type === "delta") {
    if (msg.traffic || msg.statusChanges) {
      opts.onDelta(
        {
          traffic: msg.traffic ?? null,
          statusChanges: msg.statusChanges ?? [],
          ...(msg.billingChanges ? { billingChanges: msg.billingChanges } : {}),
        },
        msg.time,
      );
    }
    return true;
  }
  if (msg.type === "alerts") {
    opts.onAlerts?.(
      { active: msg.active ?? [], ended: msg.ended ?? [] },
      msg.time,
    );
    return true;
  }
  if (msg.type === "incidents") {
    opts.onIncidents?.(msg.cards ?? msg.incidents ?? [], msg.time);
    return true;
  }
  if (msg.type === "status") {
    opts.onDelta(
      { traffic: null, statusChanges: msg.statusChanges ?? [] },
      msg.time,
    );
    return true;
  }
  return false;
}

export function connectRealtimeWs(opts: RealtimeWsOptions): {
  close: () => void;
} {
  let closed = false;
  let ws: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let status: ConnectionStatus | null = null;

  const setStatus = (next: ConnectionStatus) => {
    if (next === status) return;
    status = next;
    opts.onStatusChange(next);
  };

  const scheduleReconnect = () => {
    if (closed || retry) return;
    retry = setTimeout(() => {
      retry = null;
      void connect();
    }, RECONNECT_MS);
  };

  const fail = () => {
    if (closed) return;
    setStatus("disconnected");
    scheduleReconnect();
  };

  async function connect() {
    if (closed) return;
    setStatus("connecting");
    let data: { token: string; wsUrl: string };
    try {
      const res = await fetch("/api/realtime/ticket", { method: "POST" });
      if (!res.ok) throw new Error(`ticket ${res.status}`);
      data = (await res.json()).data;
      if (!data?.token || !data?.wsUrl) throw new Error("ticket invalid");
    } catch {
      if (closed) return;
      fail();
      opts.fallbackToMock?.();
      return;
    }
    if (closed) return;
    const socket = new WebSocket(data.wsUrl);
    ws = socket;
    // Event dari soket lama (sudah diganti/ditutup) diabaikan.
    const current = () => !closed && ws === socket;
    socket.onopen = () => {
      if (current()) socket.send(authPayload(data.token));
    };
    socket.onmessage = (event) => {
      if (!current()) return;
      if (handleRealtimeMessage(event.data, opts)) setStatus("live");
    };
    const onEnd = () => {
      if (!current()) return;
      ws = null;
      fail();
    };
    socket.onclose = onEnd;
    socket.onerror = onEnd;
  }

  void connect();

  return {
    close() {
      closed = true;
      if (retry) clearTimeout(retry);
      retry = null;
      const socket = ws;
      ws = null;
      try {
        socket?.close();
      } catch {}
    },
  };
}
