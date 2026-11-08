import { sortAnomalies, type Anomaly } from "./anomalies.ts";
import {
  anomalyRangeStart,
  defaultAnomalyRange,
  type AnomalyRange,
} from "./anomaly-range.ts";
import {
  buildLiveDirectory,
  toLiveAnomalies,
  type LiveAlertItem,
} from "./alerts-live.ts";
import { useDashboardStore } from "./store.ts";
import { ALERT_EVENTS_SIGNAL } from "./realtime-ws.ts";

// API membatasi 200 baris per permintaan, jadi riwayat panjang dimuat per halaman.
const PAGE = 200;
// Batas pengaman: 25 halaman (5.000 anomali selesai) per penyegaran, jauh di atas
// isi database sekarang. Bila tercapai, daftar dipotong ke yang terbaru dan
// halaman memberi tahu petugas; selama di bawahnya, yang dihitung = yang tampil.
const MAX_PAGES = 25;
export const LIVE_RESOLVED_CAP = PAGE * MAX_PAGES;

async function get(
  query: string,
): Promise<{ items: LiveAlertItem[]; total: number }> {
  const res = await fetch(`/api/alerts?${query}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: LiveAlertItem[];
    meta?: { total?: number };
  };
  const items = json.data ?? [];
  return { items, total: json.meta?.total ?? items.length };
}

async function getAll(query: string) {
  const items: LiveAlertItem[] = [];
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await get(`${query}&limit=${PAGE}&offset=${page * PAGE}`);
    items.push(...result.items);
    total = result.total;
    if (result.items.length < PAGE || items.length >= total) break;
  }
  return { items, total };
}

export interface LiveAnomalySet {
  // Aktif ditambah riwayat yang dimuat. Untuk "hari ini" riwayatnya mulai 24 jam
  // lalu (kartu "24 jam terakhir" butuh itu); halaman menyaringnya ke tengah malam.
  anomalies: Anomaly[];
  // Jumlah anomali selesai pada periode itu menurut database (bukan yang dimuat),
  // atau null bila jendela yang dimuat lebih lebar dari periodenya.
  resolvedTotal: number | null;
}

// Mode live untuk halaman Deteksi Anomali: baris tabel `alerts` (diisi rule engine
// Go), aktif ditambah riwayat dalam periode yang dipilih. Yang aktif sama persis
// dengan halaman Alert karena sumbernya satu tabel.
export async function loadLiveAnomalies(
  nowSec = Math.floor(Date.now() / 1000),
  range: AnomalyRange = defaultAnomalyRange,
): Promise<LiveAnomalySet> {
  const rangeFrom = anomalyRangeStart(range, nowSec);
  const fetchFrom =
    rangeFrom === null ? null : Math.min(rangeFrom, nowSec - 86_400);
  const [active, resolved] = await Promise.all([
    getAll("status=active"),
    getAll(`status=resolved${fetchFrom === null ? "" : `&from=${fetchFrom}`}`),
  ]);
  const { routers, customers } = useDashboardStore.getState();
  // Paging dengan offset bisa menggeser baris saat alert baru selesai di sela
  // permintaan: satu id tidak boleh muncul dua kali.
  const items = [
    ...new Map(
      [...active.items, ...resolved.items].map((item) => [item.id, item]),
    ).values(),
  ];
  // Total dari database hanya dipakai bila pemuatan terpotong batas; selain itu
  // yang dihitung persis yang tampil. Jenis alert yang tidak dikenal halaman ini
  // (mis. billing_mismatch) tidak masuk daftar, jadi tidak boleh ikut dihitung.
  const capped =
    resolved.items.length >= LIVE_RESOLVED_CAP &&
    resolved.total > resolved.items.length;
  const anomalies = sortAnomalies(
    toLiveAnomalies(items, buildLiveDirectory(routers, customers, items)),
  );
  const shownResolved = anomalies.filter((a) => a.endedAt !== null).length;
  return {
    anomalies,
    resolvedTotal:
      fetchFrom === rangeFrom
        ? capped
          ? resolved.total
          : shownResolved
        : null,
  };
}

export type AnomalyListener = (payload: unknown) => void;

/**
 * Membuka koneksi WebSocket ke Go backend (ws://localhost:8080/ws) agar saat Go
 * mendeteksi anomali, UI langsung menerima event secara instan.
 */
export function subscribeAnomalyWs(onNewAnomaly: AnomalyListener): () => void {
  if (typeof window === "undefined") return () => {};

  let timer: NodeJS.Timeout | number | undefined;
  const trigger = (payload: unknown) => {
    clearTimeout(timer);
    timer = setTimeout(() => onNewAnomaly(payload), 150);
  };

  const wsUrl = process.env.NEXT_PUBLIC_GO_WS_URL || "ws://localhost:8080/ws";
  let socket: WebSocket | null = null;
  try {
    socket = new WebSocket(wsUrl);
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data));
        if (
          data.type === "anomaly_event" ||
          data.event === "anomaly" ||
          data.type === "events"
        ) {
          trigger(data.payload ?? data);
        }
      } catch {}
    };
    socket.onerror = () => {};
  } catch {}

  const onSignal = (event: Event) => {
    trigger((event as CustomEvent).detail ?? null);
  };
  window.addEventListener(ALERT_EVENTS_SIGNAL, onSignal);

  return () => {
    clearTimeout(timer);
    try {
      socket?.close();
    } catch {}
    window.removeEventListener(ALERT_EVENTS_SIGNAL, onSignal);
  };
}
