import type { Metadata } from "next";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { NetflowBoard } from "@/components/dashboard/netflow-board";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Analisis Trafik NetFlow" };

export default async function NetflowPage() {
  await requireSession();
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Analisis Trafik NetFlow (Port 2055)
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Inspeksi aliran trafik IP per router, protokol, dan aplikasi
            teratas.
          </p>
        </div>
        <MockDataNotice source="aliran NetFlow v5/v9 di backend" />
      </div>
      <NetflowBoard />
    </div>
  );
}
