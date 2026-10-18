import { Network, Server, Signal, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { NetworkMapData } from "@/services/network-map.service";

interface CoverageMapProps {
  summary: NetworkMapData["summary"];
}

export function CoverageMap({ summary }: CoverageMapProps) {
  const onlinePct =
    summary.totalCustomers > 0
      ? Math.round((summary.onlineCustomers / summary.totalCustomers) * 100)
      : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
      {/* Total Pelanggan */}
      <Card className="shadow-xs border-muted">
        <CardContent className="p-3">
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-[11px] font-medium">Pelanggan DB</span>
            <Users className="size-3.5" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold tabular-nums text-foreground">
              {summary.totalCustomers}
            </span>
            <span className="text-[10px] text-emerald-600 font-medium">
              {onlinePct}% Aktif
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Online */}
      <Card className="shadow-xs border-muted">
        <CardContent className="p-3">
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-[11px] font-medium">Sesi Online</span>
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {summary.onlineCustomers}
            </span>
            <span className="text-[10px] text-muted-foreground">koneksi</span>
          </div>
        </CardContent>
      </Card>

      {/* Offline */}
      <Card className="shadow-xs border-muted">
        <CardContent className="p-3">
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-[11px] font-medium">Sesi Offline</span>
            <span className="size-2 rounded-full bg-red-500" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold tabular-nums text-red-600 dark:text-red-400">
              {summary.offlineCustomers}
            </span>
            <span className="text-[10px] text-muted-foreground">LOS/putus</span>
          </div>
        </CardContent>
      </Card>

      {/* Optik Lemah */}
      <Card className="shadow-xs border-muted">
        <CardContent className="p-3">
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-[11px] font-medium">Redaman Kritis</span>
            <Signal className="size-3.5 text-amber-500" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {summary.criticalOpticsCount}
            </span>
            <span className="text-[10px] text-muted-foreground">&le; -24.5 dBm</span>
          </div>
        </CardContent>
      </Card>

      {/* Titik Distribusi ODP */}
      <Card className="shadow-xs border-muted">
        <CardContent className="p-3">
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-[11px] font-medium">Kotak ODP</span>
            <Network className="size-3.5 text-cyan-500" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold tabular-nums text-cyan-600 dark:text-cyan-400">
              {summary.totalOdps}
            </span>
            <span className="text-[10px] text-muted-foreground">sebaran</span>
          </div>
        </CardContent>
      </Card>

      {/* Sentral OLT & Router */}
      <Card className="shadow-xs border-muted">
        <CardContent className="p-3">
          <div className="flex items-center justify-between text-muted-foreground mb-1">
            <span className="text-[11px] font-medium">Sentral Core</span>
            <Server className="size-3.5 text-violet-500" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold tabular-nums text-violet-600 dark:text-violet-400">
              {summary.totalOlts + summary.totalRouters}
            </span>
            <span className="text-[10px] text-muted-foreground">1 OLT • 1 RTR</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
