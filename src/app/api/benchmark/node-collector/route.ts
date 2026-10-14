import {
  collect,
  memory,
  resolveSimulatorUrl,
  timed,
} from "@/lib/benchmark/engine";
import { benchmarkHandler } from "@/lib/benchmark/handler";

export const dynamic = "force-dynamic";

export const GET = (request: Request) =>
  benchmarkHandler(request, async (url) => {
    const base = resolveSimulatorUrl(url.searchParams.get("url"));
    const { result, durationMs } = await timed(() => collect(base));
    return {
      durationMs,
      body: {
        engine: "node",
        subsystem: "collector",
        durationMs,
        memoryUsage: memory(),
        data: result,
      },
    };
  });
