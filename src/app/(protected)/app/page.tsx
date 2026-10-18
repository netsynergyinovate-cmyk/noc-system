import type { Metadata } from "next";
import { NocDenseDashboard } from "@/components/dashboard/noc-dense-dashboard";
import { DashboardMetricBoard } from "@/components/dashboard/dashboard-metric-board";
import { MapFocusFromUrl } from "@/components/dashboard/map-focus-from-url";
import { StreamDisconnectedBanner } from "@/components/dashboard/stream-disconnected-banner";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { AnomalyBadge } from "@/components/dashboard/anomaly-badge";
import { LiveStatus } from "@/components/dashboard/live-status";
import { DashboardAutoRefresh } from "@/components/dashboard/dashboard-auto-refresh";
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
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl text-foreground">
            Dashboard NOC
          </h1>
          <p className="text-xs text-muted-foreground">
            Telemetri riil MikroTik Core CIARA, OLT HSGQ, dan pelanggan PPPoE aktif.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MockDataNotice real />
          <AnomalyBadge />
          <LiveStatus />
          <DashboardAutoRefresh />
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
