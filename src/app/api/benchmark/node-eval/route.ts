import { evaluate, memory, parseNow, timed } from "@/lib/benchmark/engine";
import { benchmarkHandler } from "@/lib/benchmark/handler";

export const dynamic = "force-dynamic";

export const GET = (request: Request) =>
  benchmarkHandler(request, async (url) => {
    const now = parseNow(url.searchParams.get("t"));
    const { result: anomalies, durationMs } = await timed(() => evaluate(now));
    return {
      durationMs,
      body: {
        engine: "node",
        subsystem: "rule_engine",
        durationMs,
        memoryUsage: memory(),
        anomaliesCount: anomalies.length,
        anomalies,
      },
    };
  });
