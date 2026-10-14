import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { RouterTable } from "@/components/dashboard/router-table";
import { NetworkOverviewPanel } from "@/components/dashboard/network-overview-panel";
import { DeviceStatusCardGrid } from "@/components/dashboard/device-status-card-grid";
import { UnreachableDeviceBanner } from "@/components/dashboard/unreachable-device-banner";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { Activity, Layers, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export const metadata: Metadata = { title: "Kelola Router" };

export default async function RouterPage() {
  await requireSession();
  
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Kelola Router
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Daftar router MikroTik yang terhubung dan dipantau.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" asChild>
            <Link href="/app/router/queues">
              <Layers className="size-4" />
              Daftar Queue
            </Link>
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" asChild>
            <Link href="/app/router/test">
              <Activity className="size-4" />
              Uji Koneksi
            </Link>
          </Button>
          <Button size="sm" className="gap-1.5" asChild>
            <Link href="/app/router/new">
              <Plus className="size-4" />
              Tambah Router
            </Link>
          </Button>
        </div>
      </div>

      <div>
        <MockDataNotice source="REST API RouterOS v7" real />
      </div>

      <UnreachableDeviceBanner scope="router" />

      <DeviceStatusCardGrid />

      <NetworkOverviewPanel />

      <RouterTable />
    </div>
  );
}

