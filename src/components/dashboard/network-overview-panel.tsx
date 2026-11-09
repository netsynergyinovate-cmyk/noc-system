"use client";

import { useMemo } from "react";
import { Activity, Cpu, Router, Users } from "lucide-react";
import { useDashboardStore } from "@/lib/dashboard/store";
import { formatInteger } from "@/lib/dashboard/format";
import { useRouterResources } from "@/lib/dashboard/use-router-resources";
import { MetricCard } from "./metric-card";

const CPU_WARN_PERCENT = 80;
const HEALTH_OK_SCORE = 90;

// Ringkasan topologi di atas tabel router.
export function NetworkOverviewPanel() {
  const routers = useDashboardStore((s) => s.routers);
  const customers = useDashboardStore((s) => s.customers);
  const resources = useRouterResources(true);

  const { overview, avgCpu } = useMemo(() => {
    const activeCount = routers.filter((r) => r.active).length;
    const readable = (resources.items ?? []).filter((item) => item.active);
    const liveCpu = readable.length
      ? Math.round(
          readable.reduce((n, item) => n + item.cpuLoad, 0) / readable.length,
        )
      : 0;
    return {
      overview: {
        totalRouters: routers.length,
        activeRouters: activeCount,
        offlineRouters: routers.length - activeCount,
        totalInterfaces: 0,
        totalQueues: (resources.items ?? []).reduce(
          (n, item) => n + (item.queueCount ?? 0),
          0,
        ),
        totalActivePppoe: customers.filter((c) => c.isOnline).length,
        networkHealthScore:
          routers.length > 0
            ? Math.round((activeCount / routers.length) * 100)
            : 0,
        sourceStatus: "nyata" as const,
        lastScannedAt: new Date().toISOString(),
      },
      avgCpu: liveCpu,
    };
  }, [routers, customers, resources.items]);

  return (
    <section
      aria-label="Ringkasan jaringan"
      data-testid="network-overview-panel"
      className="flex flex-col gap-3"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Router Online / Aktif"
          value={`${formatInteger(overview.activeRouters)} / ${formatInteger(overview.totalRouters)}`}
          hint={`${formatInteger(overview.offlineRouters)} router offline`}
          Icon={Router}
          tone="success"
        />
        <MetricCard
          label="Total Sesi PPPoE"
          value={formatInteger(overview.totalActivePppoe)}
          hint="Pelanggan aktif di semua router"
          Icon={Users}
        />
        <MetricCard
          label="Beban CPU Rata-rata"
          value={`${avgCpu}%`}
          hint="Rata-rata router yang menyala"
          Icon={Cpu}
          tone={avgCpu > CPU_WARN_PERCENT ? "warning" : "neutral"}
        />
        <MetricCard
          label="Skor Kesehatan Jaringan"
          value={`${overview.networkHealthScore}%`}
          hint="Online penuh, degraded setengah, offline nol"
          Icon={Activity}
          tone={
            overview.networkHealthScore >= HEALTH_OK_SCORE
              ? "success"
              : "warning"
          }
        />
      </div>
    </section>
  );
}
