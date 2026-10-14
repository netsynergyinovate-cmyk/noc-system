"use client";

import { useMemo } from "react";
import { Activity, Cpu, FlaskConical, Router, Users } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { useDashboardStore } from "@/lib/dashboard/store";
import {
  getMockNetworkOverview,
  getMockRouterItems,
  isNetworkMockActive,
} from "@/lib/dashboard/network-mock-data";
import { formatInteger } from "@/lib/dashboard/format";
import { MetricCard } from "./metric-card";

const CPU_WARN_PERCENT = 80;
const HEALTH_OK_SCORE = 90;

// Ringkasan topologi di atas tabel router.
export function NetworkOverviewPanel() {
  const isDemo = useSession(selectPreviewEnabled);
  const routers = useDashboardStore((s) => s.routers);

  const { overview, avgCpu } = useMemo(() => {
    if (!isDemo) {
      // Live Mode: hitung dari router riil di store
      const activeCount = routers.filter((r) => r.active).length;
      return {
        overview: {
          totalRouters: routers.length,
          activeRouters: activeCount,
          offlineRouters: routers.length - activeCount,
          totalInterfaces: 0,
          totalQueues: 0,
          totalActivePppoe: 0,
          networkHealthScore: routers.length > 0 ? Math.round((activeCount / routers.length) * 100) : 0,
          sourceStatus: "nyata" as const,
          lastScannedAt: new Date().toISOString(),
        },
        avgCpu: 0,
      };
    }
    const items = getMockRouterItems();
    const live = items.filter((r) => r.status !== "offline");
    const cpu = live.length
      ? Math.round(live.reduce((n, r) => n + r.cpuPercent, 0) / live.length)
      : 0;
    return { overview: getMockNetworkOverview(items), avgCpu: cpu };
  }, [isDemo, routers]);

  return (
    <section
      aria-label="Ringkasan jaringan"
      data-testid="network-overview-panel"
      className="flex flex-col gap-3"
    >
      {isNetworkMockActive(overview.sourceStatus) && (
        <p
          data-testid="network-mock-badge"
          className="inline-flex w-fit flex-wrap items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-warning"
        >
          <FlaskConical className="size-3.5" aria-hidden="true" />
          Data Tiruan Jaringan (Fase 2)
          <span className="font-normal">
            · Wajib beralih ke MikroTik nyata di Fase 5
          </span>
        </p>
      )}
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
          tone={overview.networkHealthScore >= HEALTH_OK_SCORE ? "success" : "warning"}
        />
      </div>
    </section>
  );
}
