import {
  memory,
  parseNow,
  parseRange,
  timed,
  traffic,
} from "@/lib/benchmark/engine";
import { benchmarkHandler } from "@/lib/benchmark/handler";

export const dynamic = "force-dynamic";

export const GET = (request: Request) =>
  benchmarkHandler(request, async (url) => {
    const range = parseRange(url.searchParams.get("range"));
    const now = parseNow(url.searchParams.get("t"));
    const { result, durationMs } = await timed(async () => await traffic(range, now));
    return {
      durationMs,
      body: {
        engine: "node",
        subsystem: "traffic",
        durationMs,
        memoryUsage: memory(),
        ...result,
      },
    };
  });
