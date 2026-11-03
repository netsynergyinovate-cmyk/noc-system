import { NextResponse } from "next/server";
import { isBenchmarkAuthorized } from "./auth";
import { BenchmarkError } from "./engine";

// Pembungkus bersama semua endpoint benchmark: auth, error aman, Server-Timing.
export async function benchmarkHandler(
  request: Request,
  run: (url: URL) => Promise<{ durationMs: number; body: Record<string, unknown> }>,
) {
  if (!(await isBenchmarkAuthorized(request)))
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Sesi admin atau x-benchmark-key diperlukan." } },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  try {
    const { durationMs, body } = await run(new URL(request.url));
    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Server-Timing": `app;dur=${durationMs.toFixed(3)}`,
      },
    });
  } catch (error) {
    if (error instanceof BenchmarkError)
      return NextResponse.json(
        { error: { code: "BENCHMARK_ERROR", message: error.message } },
        { status: error.status, headers: { "Cache-Control": "private, no-store" } },
      );
    console.error("Benchmark failure:", error instanceof Error ? error.name : "UnknownError");
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Something went wrong." } },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
