"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  PlusCircle,
  Receipt,
  Router,
  TriangleAlert,
  Wifi,
  WifiOff,
} from "lucide-react";
import { formatInteger, formatMbps } from "@/lib/dashboard/format";

import { useAlertStore } from "@/lib/dashboard/alert-store";
import { useDashboardStore } from "@/lib/dashboard/store";
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
    <div className="flex items-center gap-2.5">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60">
        <Icon
          className="size-3.5 text-muted-foreground"
          aria-hidden="true"
        />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground leading-none">{label}</p>
        <div className="flex items-baseline gap-1.5 mt-1">
          <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
          {hint && <span className="text-[10px] text-muted-foreground/80 leading-none">({hint})</span>}
        </div>
      </div>
    </div>
  );
}

// Papan metrik: empat kartu utama + panel ringkasan. Angka dihitung dari store
// (pelanggan, router, traffic, alert); tanpa data jatuh ke data tiruan.
export function DashboardMetricBoard() {
  const customers = useDashboardStore((s) => s.customers);
  const routers = useDashboardStore((s) => s.routers);
  const traffic = useDashboardStore((s) => s.traffic);
  const activeAlerts = useAlertStore((s) => s.active);

  const m = useMemo(() => {
    let onlineCount = 0;
    let weakSignalCount = 0;
    let criticalSignalCount = 0;
    let billingPaidCount = 0;
    let billingIsolatedCount = 0;
    for (const c of customers) {
      if (c.isOnline) {
        onlineCount += 1;
        if (c.opticalPowerDbm < -25) weakSignalCount += 1;
        if (c.opticalPowerDbm < -28) criticalSignalCount += 1;
      }
      if (c.billingStatus === "lunas") billingPaidCount += 1;
      else if (c.billingStatus === "isolir") billingIsolatedCount += 1;
    }
    const last = (arr?: readonly number[]) => (arr && arr.length > 0 ? arr[arr.length - 1] : 0);
    return {
      onlineCount,
      offlineCount: customers.length - onlineCount,
      totalCustomers: customers.length,
      weakSignalCount,
      criticalSignalCount,
      activeRouterCount: routers.filter((r) => r.active).length,
      totalRouters: routers.length,
      totalBandwidthInMbps: Math.round(last(traffic?.rx) * 10) / 10,
      totalBandwidthOutMbps: Math.round(last(traffic?.tx) * 10) / 10,
      activeAlertsCount: activeAlerts?.length ?? 0,
      criticalAlertsCount: activeAlerts?.filter((a) => a.severity === "critical").length ?? 0,
      warningAlertsCount: activeAlerts?.filter((a) => a.severity === "warning").length ?? 0,
      billingPaidCount,
      billingIsolatedCount,
    };
  }, [customers, routers, traffic, activeAlerts]);
  const pct = (count: number) =>
    m.totalCustomers === 0
      ? 0
      : Math.round((count / m.totalCustomers) * 100);

  return (
    <div className="flex flex-col gap-4">
      {m.totalCustomers === 0 && m.totalRouters === 0 && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="space-y-0.5">
            <p className="font-semibold text-foreground flex items-center gap-2">
              <span className="size-2 rounded-full bg-primary/70" />
              Belum Ada Perangkat Terhubung
            </p>
            <p className="text-xs text-muted-foreground">
              Hubungkan router MikroTik atau OLT untuk mulai mengumpulkan telemetri jaringan.
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
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
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

      <Card data-testid="metric-board-summary" className="py-2.5 px-4 shadow-2xs">
        <CardContent className="p-0 flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 shrink-0">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ringkasan terpadu</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-6">
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
