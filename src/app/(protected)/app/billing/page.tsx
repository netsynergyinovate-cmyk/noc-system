import type { Metadata } from "next";
import { RunsnetBillingBoard } from "@/components/dashboard/runsnet-billing-board";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Billing & Tagihan RunsNet" };

export default async function BillingPage() {
  await requireSession();
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl text-foreground">
          Sistem Billing &amp; Tagihan Pelanggan
        </h1>
        <p className="text-sm text-muted-foreground">
          Sinkronisasi operasional dengan aplikasi billing <span className="font-mono text-foreground font-medium">app.runsnet.id</span>. Menampilkan data Pelanggan, Invoice, dan Riwayat Pembayaran.
        </p>
      </div>
      <RunsnetBillingBoard />
    </div>
  );
}
