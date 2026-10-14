import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { CpeBoard } from "@/components/dashboard/cpe-board";
import { PonPortsTable } from "@/components/dashboard/pon-ports-table";
import { UnreachableDeviceBanner } from "@/components/dashboard/unreachable-device-banner";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";

export const metadata: Metadata = { title: "Perangkat CPE & OLT" };

export default async function CpePage() {
  await requireSession();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Perangkat CPE &amp; OLT
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pemantauan modem ONT pelanggan, redaman optik fiber (RX dBm), status port PON, dan kendali jarak jauh CPE.
          </p>
        </div>
        <MockDataNotice source="OLT & CPE" />
      </div>
      <UnreachableDeviceBanner scope="olt" />
      <CpeBoard />
      <PonPortsTable />
    </div>
  );
}

