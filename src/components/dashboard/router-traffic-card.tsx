"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, ArrowDown, ArrowUp, RadioOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBitrate, formatBytes } from "@/lib/dashboard/routers";
import {
  getMockRouterTraffic,
  isTrafficEmpty,
  type RouterTrafficStats,
} from "@/lib/dashboard/router-traffic";

export interface RouterTrafficCardProps {
  routerId: string;
  routerName: string;
  active?: boolean;
  initialStats?: RouterTrafficStats;
  className?: string;
}

function Column({
  label,
  icon: Icon,
  bps,
  peak,
  avg,
  total,
}: {
  label: string;
  icon: typeof ArrowDown;
  bps: number;
  peak: number;
  avg: number;
  total: number;
}) {
  return (
    <div className="rounded-lg border p-3 text-xs">
      <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </div>
      <strong className="font-mono text-lg font-semibold tabular-nums">{formatBitrate(bps)}</strong>
      <dl className="mt-2 space-y-1">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Puncak (Peak)</dt>
          <dd className="font-mono tabular-nums">{formatBitrate(peak)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Rata-rata (Avg)</dt>
          <dd className="font-mono tabular-nums">{formatBitrate(avg)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Total</dt>
          <dd className="font-mono tabular-nums">{formatBytes(total)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function RouterTrafficCard({
  routerId,
  routerName,
  active = true,
  initialStats,
  className,
}: RouterTrafficCardProps) {
  const [fallback] = useState(() => getMockRouterTraffic(routerId, active));
  const stats = initialStats ?? fallback;
  const empty = isTrafficEmpty(stats);
  const sum = stats.rxBps + stats.txBps;
  const rxPct = sum > 0 ? Math.round((stats.rxBps / sum) * 100) : 0;

  return (
    <Card className={className} aria-label={`Trafik ${routerName}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="size-4" aria-hidden="true" />
          Trafik Interface &amp; Bandwidth
        </CardTitle>
        {empty ? (
          <Badge variant="outline" className="border-destructive/50 text-destructive">
            Data Kosong
          </Badge>
        ) : (
          <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
            REST Live (Mock)
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {empty ? (
          <div
            data-testid="traffic-empty-state"
            className="flex flex-col items-center gap-2 py-6 text-center"
          >
            <RadioOff className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-semibold">Belum Ada Sampel Trafik</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Router tidak aktif atau belum ada sampel trafik yang terekam via REST API RouterOS.
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              Masuk 0 bps · Keluar 0 bps
            </p>
            <Link
              href="/app/router/test"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-1 h-8 text-xs")}
            >
              Uji Koneksi Router
            </Link>
          </div>
        ) : (
          <div data-testid="router-traffic-content" className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Column
                label="Trafik Masuk / Download"
                icon={ArrowDown}
                bps={stats.rxBps}
                peak={stats.peakRxBps}
                avg={stats.avgRxBps}
                total={stats.rxTotalBytes}
              />
              <Column
                label="Trafik Keluar / Upload"
                icon={ArrowUp}
                bps={stats.txBps}
                peak={stats.peakTxBps}
                avg={stats.avgTxBps}
                total={stats.txTotalBytes}
              />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                <span>RX {rxPct}%</span>
                <span>TX {100 - rxPct}%</span>
              </div>
              <div
                role="progressbar"
                aria-label="Rasio RX terhadap TX"
                aria-valuenow={rxPct}
                aria-valuemin={0}
                aria-valuemax={100}
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full bg-primary" style={{ width: `${rxPct}%` }} aria-hidden="true" />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
