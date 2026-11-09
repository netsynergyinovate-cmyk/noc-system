import type { Metadata } from "next";
import { NocDenseDashboard } from "@/components/dashboard/noc-dense-dashboard";
import { DashboardMetricBoard } from "@/components/dashboard/dashboard-metric-board";
import { MapFocusFromUrl } from "@/components/dashboard/map-focus-from-url";
import { StreamDisconnectedBanner } from "@/components/dashboard/stream-disconnected-banner";
import { AnomalyBadge } from "@/components/dashboard/anomaly-badge";
import { LiveStatus } from "@/components/dashboard/live-status";
import { readFocusId } from "@/lib/dashboard/map-focus";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard NOC" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string | string[] }>;
}) {
  await requireSession();
  const focusId = readFocusId((await searchParams).focus);

  return (
    <div className="flex w-full flex-col gap-3">
      {focusId && <MapFocusFromUrl customerId={focusId} />}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-foreground">
            Dashboard NOC
          </h1>
          <p className="text-[11px] text-muted-foreground">
            Telemetri riil MikroTik, OLT, dan pelanggan PPPoE, diterima langsung
            dari backend.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AnomalyBadge />
          <LiveStatus />
        </div>
      </div>
      <StreamDisconnectedBanner />
      <NocDenseDashboard />
      <div className="sr-only" aria-hidden="true">
        <DashboardMetricBoard />
      </div>
    </div>
  );
}
