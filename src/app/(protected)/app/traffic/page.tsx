import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { TrafficTrendBoard } from "@/components/dashboard/traffic-trend-board";

export const metadata: Metadata = { title: "Trafik & Tren Bandwidth" };

export default async function TrafficPage() {
  await requireSession();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Trafik &amp; Tren Bandwidth
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pemantauan throughput bandwidth unduh/unggah real-time dan analisis utilisasi kapasitas
          link interface.
        </p>
      </div>
      <div>
        <MockDataNotice source="sampel trafik MikroTik" />
      </div>
      <TrafficTrendBoard nowSec={Math.floor(Date.now() / 1000)} />
    </div>
  );
}
