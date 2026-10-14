import type { Metadata } from "next";
import { AnomalyBoard } from "@/components/dashboard/anomaly-board";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Deteksi Anomali" };

export default async function AnomalyPage() {
  await requireSession();
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Deteksi Anomali
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gangguan yang terdeteksi otomatis: jalur penuh, router terbebani,
            error port, sinyal optik lemah, dan pelanggan offline.
          </p>
        </div>
        <MockDataNotice />
      </div>
      <AnomalyBoard />
    </div>
  );
}
