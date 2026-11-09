import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { TrafficTrendBoard } from "@/components/dashboard/traffic-trend-board";

export const metadata: Metadata = { title: "Trafik & Tren Bandwidth" };

export default async function TrafficPage() {
  await requireSession();

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Trafik &amp; Tren Bandwidth
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Pemantauan throughput bandwidth unduh/unggah real-time dan analisis utilisasi kapasitas
          link interface.
        </p>
      </div>
      <TrafficTrendBoard nowSec={Math.floor(Date.now() / 1000)} />
    </div>
  );
}
