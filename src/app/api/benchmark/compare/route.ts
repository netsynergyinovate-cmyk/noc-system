import {
  collect,
  evaluate,
  memory,
  parseNow,
  parseRange,
  resolveSimulatorUrl,
  timed,
  traffic,
} from "@/lib/benchmark/engine";
import { benchmarkHandler } from "@/lib/benchmark/handler";

export const dynamic = "force-dynamic";

// Satu siklus penuh: koleksi, evaluasi, lalu penyajian traffic, berurutan
// seperti pipeline layanan Go.
export const GET = (request: Request) =>
  benchmarkHandler(request, async (url) => {
    const base = resolveSimulatorUrl(url.searchParams.get("url"));
    const range = parseRange(url.searchParams.get("range"));
    const now = parseNow(url.searchParams.get("t"));

    const total = await timed(async () => {
      const collector = await timed(() => collect(base));
      const eval_ = await timed(() => evaluate(now));
      const series = await timed(async () => await traffic(range, now));
      return {
        collector: { durationMs: collector.durationMs, data: collector.result },
        eval: {
          durationMs: eval_.durationMs,
          anomaliesCount: eval_.result.length,
        },
        traffic: {
          durationMs: series.durationMs,
          range,
          points: series.result.points,
        },
      };
    });
    return {
      durationMs: total.durationMs,
      body: {
        engine: "node",
        totalDurationMs: total.durationMs,
        steps: total.result,
        memoryUsage: memory(),
      },
    };
  });
