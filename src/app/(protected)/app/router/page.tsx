import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { RouterTable } from "@/components/dashboard/router-table";
import { InactiveRouterList } from "@/components/dashboard/inactive-router-list";
import { NetworkOverviewPanel } from "@/components/dashboard/network-overview-panel";
import { DeviceStatusCardGrid } from "@/components/dashboard/device-status-card-grid";
import { UnreachableDeviceBanner } from "@/components/dashboard/unreachable-device-banner";
import { Activity, Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export const metadata: Metadata = { title: "Kelola Router" };

export default async function RouterPage() {
  await requireSession();

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Header Controls & Title Section */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-border">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Kelola Router
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground max-w-3xl">
            Daftar router MikroTik yang terhubung dan dipantau secara real-time
            via REST &amp; Winbox API dengan visualisasi throughput antarmuka.
          </p>
        </div>

        {/* Header Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            size="sm"
            variant="outline"
            className="h-9 px-3.5 rounded-xl font-mono text-xs uppercase gap-1.5"
            asChild
          >
            <Link href="/app/router/queues">
              <Layers className="size-3.5 text-primary" />
              Daftar Queue
            </Link>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9 px-3.5 rounded-xl font-mono text-xs uppercase gap-1.5"
            asChild
          >
            <Link href="/app/router/test">
              <Activity className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              Uji Koneksi
            </Link>
          </Button>
          <Button
            size="sm"
            className="h-9 px-3.5 rounded-xl font-mono text-xs uppercase font-semibold gap-1.5 shadow-xs"
            asChild
          >
            <Link href="/app/router/new">
              <Plus className="size-3.5" />
              Tambah Router
            </Link>
          </Button>
        </div>
      </div>

      <UnreachableDeviceBanner scope="router" />

      {/* Ringkasan Topologi & Status Jaringan */}
      <NetworkOverviewPanel />

      {/* Main Telemetry & Dashboard Board */}
      <RouterTable />

      <InactiveRouterList />

      {/* Grid Status Ringkasan Perangkat Jaringan */}
      <DeviceStatusCardGrid />
    </div>
  );
}
