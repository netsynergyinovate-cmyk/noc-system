import { backendGet } from "./backend-api.ts";
import type { TrafficHistory } from "./history.ts";
import { getRange, type TrafficRangeId } from "./ranges.ts";

// Bentuk jawaban GET /api/v1/traffic/history (lihat backend/README.md).
interface HistoryResponse {
  from: number;
  to: number;
  step: number;
  times: number[];
  rx: number[];
  tx: number[];
}

// Histori traffic NYATA dari arsip traffic_samples lewat backend Go. Rentang
// "live" tidak lewat sini (datang dari WebSocket). Insiden belum ada sumbernya
// di sini, jadi kosong; jangan diisi data tiruan di mode live.
export async function loadLiveTrafficHistory(
  rangeId: TrafficRangeId,
): Promise<TrafficHistory> {
  const queryRange = rangeId === "live" ? "5m" : rangeId;
  const body = await backendGet<HistoryResponse>("/api/v1/traffic/history", {
    range: queryRange,
  });
  const times = Array.isArray(body.times) ? body.times : [];
  return {
    range: rangeId,
    from: body.from,
    to: body.to,
    stepSeconds: body.step || getRange(rangeId).stepSeconds || 1,
    series: {
      times,
      rx: Array.isArray(body.rx) ? body.rx : [],
      tx: Array.isArray(body.tx) ? body.tx : [],
    },
    incidents: [],
  };
}
