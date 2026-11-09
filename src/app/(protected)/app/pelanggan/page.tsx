import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MapPin } from "lucide-react";
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
    <div className="flex w-full flex-col gap-6">
      {focusId && <MapFocusFromUrl customerId={focusId} />}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Daftar Pelanggan
          </h1>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
          >
            <Link href="/app/peta">
              <MapPin className="size-3.5 text-primary" />
              <span>Lihat Peta Pelanggan</span>
            </Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Kelola perangkat pelanggan (CPE) dan pantau status koneksi, sinyal,
          serta tagihan.
        </p>
      </div>
      <CustomerTable />
    </div>
  );
}
