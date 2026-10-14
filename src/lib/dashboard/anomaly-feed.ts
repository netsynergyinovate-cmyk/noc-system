import {
  ANOMALY_WINDOW_SECONDS,
  sortAnomalies,
  toAnomaly,
  type Anomaly,
} from "./anomalies.ts";
import { mockActiveAlerts } from "./alerts.ts";
import { currentHandled } from "./handled-registry.ts";
import { mockIncidents } from "./history.ts";

export { ANOMALY_DETECTION_MOCK_ENTRY } from "./anomaly-mock-entry.ts";

// Titik ganti ke backend: GET /api/v1/anomalies?from=&to=
//
// DATA TIRUAN. Anomali yang AKTIF diambil dari alert aktif (mockActiveAlerts),
// supaya jumlah "aktif" sama di dasbor, halaman Alert Aktif, dan halaman
// Deteksi Anomali, seperti pada backend sungguhan di mana keduanya adalah baris
// network_logs yang sama. Riwayatnya dari penanda insiden di grafik traffic
// (mockIncidents), hanya yang sudah selesai; insiden grafik yang kebetulan
// masih berjalan tidak ikut, supaya tidak ada anomali aktif yang tidak muncul
// di daftar alert.
export async function loadAnomalies(
  nowSec = Math.floor(Date.now() / 1000),
): Promise<Anomaly[]> {
  const history = mockIncidents(nowSec - ANOMALY_WINDOW_SECONDS, nowSec, nowSec)
    .filter((incident) => incident.endedAt !== null)
    .map(toAnomaly);
  // ActiveAlert adalah Anomali dengan isian tambahan; isian itu tidak dibuang
  // karena tidak mengganggu dan tetap benar. Alert yang sudah ditandai ditangani
  // petugas tidak lagi aktif, jadi hitungan "aktif" tetap sama dengan halaman Alert.
  return sortAnomalies([
    ...history,
    ...mockActiveAlerts(nowSec, currentHandled()),
  ]);
}
