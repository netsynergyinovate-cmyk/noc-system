import type { Metadata } from "next";
import { BillingBoard } from "@/components/dashboard/billing-board";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Status Billing" };

export default async function BillingPage() {
  await requireSession();
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Status Billing
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Status pembayaran tiap pelanggan, Lunas atau Isolir, disinkronkan
            otomatis dari sistem billing dan dicocokkan lewat nama koneksi
            PPPoE.
          </p>
        </div>
        <MockDataNotice source="sistem billing" />
      </div>
      <BillingBoard />
    </div>
  );
}
