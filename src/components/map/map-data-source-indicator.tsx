"use client";

import { useState } from "react";
import {
  Database,
  Info,
  Server,
  Layers,
  Users,
  GitBranch,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { NetworkMapData } from "@/services/network-map.service";

export type MapDataSourceInfo = NetworkMapData["dataSource"];

export interface MapDataSourceIndicatorProps {
  dataSource: MapDataSourceInfo;
  summary?: {
    totalRouters: number;
    totalOlts: number;
    totalOdps: number;
    geocodedCustomers: number;
  };
  className?: string;
}

export function MapDataSourceIndicator({
  dataSource,
  summary,
  className = "",
}: MapDataSourceIndicatorProps) {
  const [showDetail, setShowDetail] = useState(false);
  const isReal = dataSource.isRealData;

  const formattedSyncTime = dataSource.lastSynchronizedAt
    ? new Date(dataSource.lastSynchronizedAt).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "-";

  return (
    <div
      className={`inline-flex items-center gap-1.5 ${className}`}
      data-testid="active-data-source-container"
    >
      {/* Badge Sumber Data Aktif: PostgreSQL Live vs Mock Lokal */}
      {isReal ? (
        <Badge
          variant="outline"
          className="text-xs gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 font-medium cursor-pointer transition-colors hover:bg-emerald-500/10"
          data-testid="data-source-badge"
          onClick={() => setShowDetail((prev) => !prev)}
          title="Sumber data aktif: PostgreSQL Live (Klik untuk detail rincian entitas)"
        >
          <Database className="size-3 text-emerald-500" />
          <span>PostgreSQL Live</span>
          <span
            className="size-1.5 rounded-full bg-emerald-500 animate-pulse ml-0.5"
            data-testid="live-data-indicator-dot"
          />
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="text-xs gap-1 border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10 font-medium cursor-pointer transition-colors hover:bg-amber-500/15"
          data-testid="data-source-badge"
          onClick={() => setShowDetail((prev) => !prev)}
          title="Sumber data aktif: Data Mock Lokal (Klik untuk detail)"
        >
          <Database className="size-3 text-amber-500" />
          <span>Data Mock Lokal</span>
        </Badge>
      )}

      {/* Tombol Info Rincian Sumber Data */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setShowDetail((prev) => !prev)}
        className="size-6 text-muted-foreground hover:text-foreground"
        data-testid="toggle-data-source-detail-button"
        title="Tampilkan rincian entitas tabel sumber data aktif"
        aria-expanded={showDetail}
      >
        <Info className="size-3.5" />
        <span className="sr-only">Rincian Sumber Data</span>
      </Button>

      {/* Panel Popover Rincian Sumber Data Aktif */}
      {showDetail && (
        <div
          className="absolute top-12 left-0 sm:left-auto z-50 w-72 rounded-lg border bg-popover/95 p-3 text-popover-foreground shadow-lg backdrop-blur-md text-xs animate-in fade-in zoom-in-95 duration-150"
          data-testid="data-source-detail-panel"
        >
          <div className="flex items-center justify-between border-b pb-2 mb-2 font-semibold text-foreground">
            <span className="flex items-center gap-1.5">
              <Database className="size-3.5 text-primary" />
              Status Sumber Data Peta
            </span>
            <span className="text-[10px] text-muted-foreground font-normal">
              {formattedSyncTime}
            </span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Mode Data:</span>
              <span className="font-semibold text-foreground">
                {isReal ? "PostgreSQL Operasional" : "Simulasi Mock"}
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">Basis Data:</span>
              <span className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded text-foreground">
                {dataSource.provider || "PostgreSQL (port 5432)"}
              </span>
            </div>

            {summary && (
              <div className="pt-1.5 border-t mt-1.5 space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Entitas Riil Terpetakan
                </p>
                <div className="grid grid-cols-2 gap-1 text-[11px]">
                  <div className="flex items-center gap-1">
                    <Server className="size-3 text-purple-500" />
                    <span>Router: <strong>{summary.totalRouters}</strong></span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Layers className="size-3 text-cyan-500" />
                    <span>OLT: <strong>{summary.totalOlts}</strong></span>
                  </div>
                  <div className="flex items-center gap-1">
                    <GitBranch className="size-3 text-amber-500" />
                    <span>ODP: <strong>{summary.totalOdps}</strong></span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Users className="size-3 text-emerald-500" />
                    <span>Klien: <strong>{summary.geocodedCustomers}</strong></span>
                  </div>
                </div>
              </div>
            )}

            <div className="pt-2 border-t mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
              <span className="italic">Zero-dummy validated</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowDetail(false)}
                className="h-5 px-1.5 text-[10px]"
              >
                Tutup
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
