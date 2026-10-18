"use client";

import React from "react";
import { cn } from "@/lib/utils";

export interface NetworkMapLegendProps {
  showCustomers: boolean;
  onToggleCustomers: () => void;
  customerCount: number;

  showInfrastructure: boolean;
  onToggleInfrastructure: () => void;
  infraCount: number;

  showCables: boolean;
  onToggleCables: () => void;
  cableCount?: number;

  className?: string;
  defaultExpanded?: boolean;
}

export function NetworkMapLegend({
  showCustomers,
  onToggleCustomers,
  customerCount,
  showInfrastructure,
  onToggleInfrastructure,
  infraCount,
  showCables,
  onToggleCables,
  cableCount,
  className,
}: NetworkMapLegendProps) {
  return (
    <div
      className={cn(
        "absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] pointer-events-auto",
        className,
      )}
      data-testid="fixed-map-legend"
    >
      <div className="flex items-center gap-0 bg-background/90 backdrop-blur-md rounded-full border border-border/60 shadow-md overflow-hidden text-[10px] font-medium select-none">

        {/* Status Pelanggan */}
        <button
          type="button"
          onClick={onToggleCustomers}
          data-testid="toggle-customers-dock"
          title={showCustomers ? `${customerCount} pelanggan — klik untuk sembunyikan` : "Tampilkan titik pelanggan"}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 transition-colors",
            showCustomers ? "text-foreground" : "text-muted-foreground/50 line-through",
          )}
        >
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-emerald-500 shrink-0" />
            Aktif
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-amber-500 ring-1 ring-amber-400 shrink-0" />
            Redaman
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-rose-500 shrink-0" />
            Isolir
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-red-600 shrink-0" />
            Offline
          </span>
        </button>

        <span className="w-px h-4 bg-border/60 shrink-0" />

        {/* Infrastruktur */}
        <button
          type="button"
          onClick={onToggleInfrastructure}
          data-testid="toggle-infrastructure-dock"
          title={showInfrastructure ? `${infraCount} perangkat — klik untuk sembunyikan` : "Tampilkan perangkat infrastruktur"}
          className={cn(
            "flex items-center gap-2 px-3 py-1.5 transition-colors",
            showInfrastructure ? "text-foreground" : "text-muted-foreground/50 line-through",
          )}
        >
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-purple-500 shrink-0" />
            Core
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-cyan-500 shrink-0" />
            OLT
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-sm bg-blue-500 shrink-0" />
            ODC
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-sm bg-amber-500 shrink-0" />
            ODP
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-slate-500 shrink-0" />
            Tiang
          </span>
        </button>

        <span className="w-px h-4 bg-border/60 shrink-0" />

        {/* Kabel */}
        <button
          type="button"
          onClick={onToggleCables}
          data-testid="toggle-cables-dock"
          title={showCables ? `${cableCount ?? 0} jalur kabel — klik untuk sembunyikan` : "Tampilkan jalur kabel fiber"}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 transition-colors",
            showCables ? "text-foreground" : "text-muted-foreground/50 line-through",
          )}
        >
          <span className="flex items-center gap-1">
            <span className="w-4 h-0.5 bg-gradient-to-r from-purple-500 via-cyan-500 to-emerald-500 rounded-full shrink-0" />
            Kabel
          </span>
        </button>

      </div>
    </div>
  );
}
