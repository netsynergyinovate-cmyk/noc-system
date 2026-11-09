import type { Metadata } from "next";
import { Suspense } from "react";
import { NetflowBoard } from "@/components/dashboard/netflow-board";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Analisis Trafik NetFlow" };

export default async function NetflowPage() {
  await requireSession();
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Analisis Trafik NetFlow (Port 2055)
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Inspeksi aliran trafik IP per router, protokol, dan aplikasi teratas.
        </p>
      </div>
      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">Memuat NetFlow…</p>
        }
      >
        <NetflowBoard />
      </Suspense>
    </div>
  );
}
