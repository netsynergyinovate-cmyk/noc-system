import type { Metadata } from "next";
import { BillingSyncChip } from "@/components/dashboard/billing-sync-chip";
import { CustomerTable } from "@/components/dashboard/customer-table";
import { requireSession } from "@/lib/session";
import { MapFocusFromUrl } from "@/components/dashboard/map-focus-from-url";
import { readFocusId } from "@/lib/dashboard/map-focus";

export const metadata: Metadata = { title: "Daftar Pelanggan" };

export default async function PelangganPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string | string[] }>;
}) {
  await requireSession();
  const focusId = readFocusId((await searchParams).focus);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      {focusId && <MapFocusFromUrl customerId={focusId} />}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Daftar Pelanggan
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Kelola perangkat pelanggan (CPE) dan pantau status koneksi, sinyal, serta tagihan.
        </p>
      </div>
      {/* Seberapa baru status tagihan di tabel ini: sinkron billing terakhir. */}
      <BillingSyncChip />
      <CustomerTable />
    </div>
  );
}

