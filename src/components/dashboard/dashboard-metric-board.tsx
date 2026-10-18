"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  FlaskConical,
  PlusCircle,
  Receipt,
  Router,
  TriangleAlert,
  Wifi,
  WifiOff,
} from "lucide-react";
import { formatInteger, formatMbps } from "@/lib/dashboard/format";
import {
  computeMetricsFromStore,
  isMetricBoardMockActive,
} from "@/lib/dashboard/metric-board-data";
import { useAlertStore } from "@/lib/dashboard/alert-store";
import { useDashboardStore } from "@/lib/dashboard/store";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MetricCard } from "./metric-card";

function MiniStat({
  Icon,
  label,
  value,
  hint,
}: {
  Icon: typeof Activity;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

// Papan metrik: empat kartu utama + panel ringkasan. Angka dihitung dari store
// (pelanggan, router, traffic, alert); tanpa data jatuh ke data tiruan.
export function DashboardMetricBoard() {
  const isDemo = useSession(selectPreviewEnabled);
  const customers = useDashboardStore((s) => s.customers);
  const routers = useDashboardStore((s) => s.routers);
  const traffic = useDashboardStore((s) => s.traffic);
  const activeAlerts = useAlertStore((s) => s.active);

  const m = useMemo(
    () =>
      computeMetricsFromStore({
        customers,
        routers,
        traffic,
        alertStore: { active: activeAlerts },
        sourceStatus: isDemo ? "dummy" : "nyata",
      }),
    [customers, routers, traffic, activeAlerts, isDemo],
  );
  const pct = (count: number) =>
    m.totalCustomers === 0
      ? 0
      : Math.round((count / m.totalCustomers) * 100);

  return (
    <div className="flex flex-col gap-4">
      {!isDemo && m.totalCustomers === 0 && m.totalRouters === 0 && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="space-y-0.5">
            <p className="font-semibold text-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              Mode Live Aktif: Belum Ada Perangkat Terhubung
            </p>
            <p className="text-xs text-muted-foreground">
              Semua data dummy telah dinonaktifkan. Hubungkan router MikroTik atau OLT Anda untuk mulai mengumpulkan telemetri nyata.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" asChild className="gap-1.5">
              <Link href="/app/router/new">
                <PlusCircle className="size-3.5" />
                Tambah Router
              </Link>
            </Button>
          </div>
        </div>
      )}
      <section
        aria-label="Ringkasan jaringan"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <MetricCard
          label="Pelanggan online"
          value={formatInteger(m.onlineCount)}
          hint={`${pct(m.onlineCount)}% dari ${formatInteger(m.totalCustomers)} pelanggan`}
          Icon={Wifi}
          tone="success"
        />
        <MetricCard
          label="Pelanggan offline"
          value={formatInteger(m.offlineCount)}
          hint={`${pct(m.offlineCount)}% dari ${formatInteger(m.totalCustomers)} pelanggan`}
          Icon={WifiOff}
          tone="danger"
        />
        <MetricCard
          label="Sinyal optik lemah"
          value={formatInteger(m.weakSignalCount)}
          hint="Pelanggan online dengan Rx di bawah -25 dBm"
          Icon={TriangleAlert}
          tone="warning"
        />
        <MetricCard
          label="Router aktif"
          value={`${formatInteger(m.activeRouterCount)} / ${formatInteger(m.totalRouters)}`}
          hint="Router MikroTik yang terhubung"
          Icon={Router}
        />
      </section>

      <Card data-testid="metric-board-summary">
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Ringkasan terpadu</h2>
            {isMetricBoardMockActive(m.sourceStatus) && (
              <p
                data-testid="metric-mock-badge"
                className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-warning"
              >
                <FlaskConical className="size-3.5" aria-hidden="true" />
                Data Tiruan (Fase 2)
                <span className="font-normal">
                  · Wajib beralih ke backend nyata di Fase 5
                </span>
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MiniStat
              Icon={ArrowDownToLine}
              label="Total traffic masuk"
              value={formatMbps(m.totalBandwidthInMbps)}
            />
            <MiniStat
              Icon={ArrowUpFromLine}
              label="Total traffic keluar"
              value={formatMbps(m.totalBandwidthOutMbps)}
            />
            <MiniStat
              Icon={TriangleAlert}
              label="Alert aktif"
              value={formatInteger(m.activeAlertsCount)}
              hint={`${formatInteger(m.criticalAlertsCount)} kritis, ${formatInteger(m.warningAlertsCount)} peringatan`}
            />
            <MiniStat
              Icon={Receipt}
              label="Tagihan"
              value={`${formatInteger(m.billingPaidCount)} lunas`}
              hint={`${formatInteger(m.billingIsolatedCount)} terisolir`}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
