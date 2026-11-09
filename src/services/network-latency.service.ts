import "server-only";
import net from "node:net";

export interface LatencyTarget {
  name: string;
  host: string;
  port: number;
}

export interface MeasuredLatencyItem {
  name: string;
  host: string;
  port: number;
  latencyMs: number | null;
  status: "online" | "timeout" | "error";
  checkedAt: string;
}

export interface NetworkLatencySummary {
  avgLatencyMs: number | null;
  onlineCount: number;
  totalCount: number;
  items: MeasuredLatencyItem[];
  measuredAt: string;
}

export const DEFAULT_LATENCY_TARGETS: readonly LatencyTarget[] = [
  { name: "Core CIARA", host: "103.167.70.136", port: 80 },
  { name: "HSGQ OLT", host: "103.167.70.136", port: 2323 },
  { name: "Cloudflare DNS", host: "1.1.1.1", port: 53 },
  { name: "Google DNS", host: "8.8.8.8", port: 53 },
];

/**
 * Mengukur latensi TCP round-trip nyata ke target jaringan fisik.
 * Mengembalikan waktu koneksi dalam milidetik (ms) tanpa manipulasi dummy.
 */
export function measureTcpLatency(
  target: LatencyTarget,
  timeoutMs = 2500,
): Promise<MeasuredLatencyItem> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const t0 = performance.now();
    let settled = false;

    const finish = (
      latencyMs: number | null,
      status: "online" | "timeout" | "error",
    ) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        name: target.name,
        host: target.host,
        port: target.port,
        latencyMs,
        status,
        checkedAt: new Date().toISOString(),
      });
    };

    socket.setTimeout(timeoutMs);

    socket.connect(target.port, target.host, () => {
      const elapsed = Math.round((performance.now() - t0) * 10) / 10;
      finish(elapsed, "online");
    });

    socket.on("timeout", () => {
      finish(null, "timeout");
    });

    socket.on("error", () => {
      finish(null, "error");
    });
  });
}

// In-memory cache selama 3 detik agar tidak membanjiri socket bila banyak request bersamaan
let cachedLatency: NetworkLatencySummary | null = null;
let lastMeasurementTime = 0;
const CACHE_TTL_MS = 3000;

export async function getNetworkLatencyOverview(
  targets = DEFAULT_LATENCY_TARGETS,
): Promise<NetworkLatencySummary> {
  const now = Date.now();
  if (cachedLatency && now - lastMeasurementTime < CACHE_TTL_MS) {
    return cachedLatency;
  }

  const results = await Promise.all(targets.map((t) => measureTcpLatency(t)));
  const onlineItems = results.filter(
    (r) => r.status === "online" && r.latencyMs !== null,
  );
  const avgLatencyMs =
    onlineItems.length > 0
      ? Math.round(
          (onlineItems.reduce((acc, curr) => acc + (curr.latencyMs ?? 0), 0) /
            onlineItems.length) *
            10,
        ) / 10
      : null;

  const summary: NetworkLatencySummary = {
    avgLatencyMs,
    onlineCount: onlineItems.length,
    totalCount: results.length,
    items: results,
    measuredAt: new Date().toISOString(),
  };

  cachedLatency = summary;
  lastMeasurementTime = now;
  return summary;
}
