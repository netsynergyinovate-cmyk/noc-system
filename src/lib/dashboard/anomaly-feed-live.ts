import { ANOMALY_WINDOW_SECONDS, sortAnomalies, type Anomaly } from "./anomalies.ts";
import { buildLiveDirectory, toLiveAnomalies, type LiveAlertItem } from "./alerts-live.ts";
import { useDashboardStore } from "./store.ts";

async function get(query: string): Promise<LiveAlertItem[]> {
  const res = await fetch(`/api/alerts?${query}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { data?: LiveAlertItem[] };
  return json.data ?? [];
}

// Mode live untuk halaman Deteksi Anomali: baris tabel `alerts` (diisi rule engine
// Go), aktif ditambah riwayat dalam jendela anomali. Yang aktif sama persis
// dengan halaman Alert karena sumbernya satu tabel.
export async function loadLiveAnomalies(
  nowSec = Math.floor(Date.now() / 1000),
): Promise<Anomaly[]> {
  const [active, resolved] = await Promise.all([
    get("status=active&limit=200"),
    get(`status=resolved&from=${nowSec - ANOMALY_WINDOW_SECONDS}&limit=200`),
  ]);
  const { routers, customers } = useDashboardStore.getState();
  const items = [...active, ...resolved];
  return sortAnomalies(toLiveAnomalies(items, buildLiveDirectory(routers, customers, items)));
}
