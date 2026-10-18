import type { Metadata } from "next";
import { ExportBoard } from "@/components/dashboard/export-board";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Ekspor Data & Laporan" };

export default async function ExportPage() {
  await requireSession();
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Ekspor Data &amp; Laporan
          </h1>
          <MockDataNotice source="data laporan di backend" />
        </div>
        <p className="text-sm text-muted-foreground">
          Unduh data pemantauan dan laporan gangguan dalam format CSV atau
          JSON.
        </p>
      </div>
      <ExportBoard />
    </div>
  );
}
