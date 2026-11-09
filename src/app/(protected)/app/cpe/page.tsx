import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { CpeBoard } from "@/components/dashboard/cpe-board";
import { UnreachableDeviceBanner } from "@/components/dashboard/unreachable-device-banner";

export const metadata: Metadata = { title: "Perangkat CPE & OLT" };

export default async function CpePage() {
  await requireSession();

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Perangkat CPE &amp; OLT
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Pemantauan OLT, port PON, status ONU, dan pemetaan pelanggan.
        </p>
      </div>
      <UnreachableDeviceBanner scope="olt" />
      <CpeBoard />
    </div>
  );
}
