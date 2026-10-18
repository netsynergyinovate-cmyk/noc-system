import type { Metadata } from "next";
import { AnomalyBoard } from "@/components/dashboard/anomaly-board";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Deteksi Anomali" };

export default async function AnomalyPage() {
  await requireSession();
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Deteksi Anomali
          </h1>
          <MockDataNotice real />
        </div>
        <p className="text-sm text-muted-foreground">
          Gangguan yang terdeteksi otomatis: jalur penuh, router terbebani,
          error port, sinyal optik lemah, dan pelanggan offline.
        </p>
      </div>
      <AnomalyBoard />
    </div>
  );
}
