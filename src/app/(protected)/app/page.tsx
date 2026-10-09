import type { Metadata } from "next";
import { CustomerTable } from "@/components/dashboard/customer-table";
import { AnomalyBadge } from "@/components/dashboard/anomaly-badge";
import { DistributionPanel } from "@/components/dashboard/distribution-panel";
import { LiveStatus } from "@/components/dashboard/live-status";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { MapFocusFromUrl } from "@/components/dashboard/map-focus-from-url";
import { MetricCards } from "@/components/dashboard/metric-cards";
import { TrafficPanel } from "@/components/dashboard/traffic-panel";
import { readFocusId } from "@/lib/dashboard/map-focus";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string | string[] }>;
}) {
  await requireSession();
  const focusId = readFocusId((await searchParams).focus);
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      {focusId && <MapFocusFromUrl customerId={focusId} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Dashboard NOC
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ringkasan jaringan pelanggan PPPoE dalam satu layar.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <LiveStatus />
          <AnomalyBadge />
          <MockDataNotice />
        </div>
      </div>
      <MetricCards />
      <div className="grid gap-6 lg:grid-cols-3">
        <TrafficPanel className="lg:col-span-2" />
        <DistributionPanel />
      </div>
      <CustomerTable />
    </div>
  );
}
