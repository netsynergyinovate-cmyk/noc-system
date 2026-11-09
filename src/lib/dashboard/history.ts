import { defaultSeverity, overlaps, sortIncidents } from "./incidents.ts";
import { getRange, type TrafficRangeId } from "./ranges.ts";
import type { Incident, IncidentKind, TrafficSeries } from "./types.ts";

// DATA TIRUAN untuk fase frontend. Semua nilai adalah fungsi dari waktu absolut,
// jadi memilih rentang yang sama dua kali menghasilkan grafik yang sama, dan
// menggeser rentang tidak mengubah titik yang sudah ada. Saat backend siap,
// cukup ganti isi loadTrafficHistory dan loadIncidents dengan pemanggilan REST
// (histori dari tabel traffic_samples, insiden dari network_logs); bentuk
// kembaliannya sudah mengikuti kontrak itu.

export interface TrafficHistory {
  range: TrafficRangeId;
  from: number;
  to: number;
  stepSeconds: number;
  series: TrafficSeries;
  incidents: Incident[];
}

const SLOT_SECONDS = 1800;
const INCIDENT_CHANCE = 0.13; // sekitar 6 insiden per hari
const CAPACITY_MBPS = 400;

const KINDS: IncidentKind[] = ["offline", "optical", "queue", "cpu", "port"];

export function mockIncidents(_from?: number, _to?: number, _now?: number): Incident[] {
  return [];
}

// Pola harian: sepi dini hari, memuncak malam hari (WIB), sedikit lebih ramai
// di akhir pekan.
function baseDownload(t: number) {
  const hour = ((((t + 7 * 3600) / 3600) % 24) + 24) % 24;
  const evening = Math.max(0, Math.cos((2 * Math.PI * (hour - 20.5)) / 24));
  const level = 0.35 + 0.65 * evening ** 2;
  const week = 1 + 0.06 * Math.sin((2 * Math.PI * t) / (7 * 24 * 3600));
  return 90 + 240 * level * week;
}

function trafficAt(t: number, _stepSeconds: number, _incidents: Incident[]) {
  const rx = baseDownload(t);
  const tx = rx * 0.18;
  return { rx: Math.round(rx * 10) / 10, tx: Math.round(tx * 10) / 10 };
}

export function buildMockHistory(
  rangeId: TrafficRangeId,
  nowSec: number,
): TrafficHistory {
  const range = getRange(rangeId);
  const step = range.stepSeconds ?? 1;
  const last = Math.floor(nowSec / step) * step;
  const count = Math.floor(range.seconds / step);
  const from = last - (count - 1) * step;
  const incidents = mockIncidents(from, last, nowSec);

  const series: TrafficSeries = { times: [], rx: [], tx: [] };
  for (let i = 0; i < count; i += 1) {
    const time = from + i * step;
    const point = trafficAt(time, step, incidents);
    series.times.push(time);
    series.rx.push(point.rx);
    series.tx.push(point.tx);
  }
  return {
    range: rangeId,
    from,
    to: last,
    stepSeconds: step,
    series,
    incidents,
  };
}

// Titik ganti ke backend: GET /api/v1/traffic/history?from=&to=&step=
export async function loadTrafficHistory(
  rangeId: TrafficRangeId,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<TrafficHistory> {
  return buildMockHistory(rangeId, nowSec);
}

// Titik ganti ke backend: GET /api/v1/incidents?from=&to=
export async function loadIncidents(
  from: number,
  to: number,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<Incident[]> {
  return mockIncidents(from, to, nowSec);
}
