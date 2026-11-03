import { sortAnomalies, toAnomaly, type Anomaly } from "./anomalies.ts";
import {
  anomalyRangeStart,
  defaultAnomalyRange,
  type AnomalyRange,
} from "./anomaly-range.ts";
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
  range: AnomalyRange = defaultAnomalyRange,
): Promise<Anomaly[]> {
  // "Semua" pada data tiruan dibatasi 90 hari. Riwayat dimuat paling sedikit 24
  // jam supaya kartu "24 jam" tidak ikut mengecil pada "hari ini"; halaman
  // menyaring daftar ke periodenya.
  const start = anomalyRangeStart(range, nowSec);
  const from =
    start === null ? nowSec - 90 * 86_400 : Math.min(start, nowSec - 86_400);
  const history = mockIncidents(from, nowSec, nowSec)
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
