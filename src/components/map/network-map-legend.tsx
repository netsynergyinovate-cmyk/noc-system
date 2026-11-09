"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ChevronUp,
  ChevronDown,
  Layers,
  MapPin,
  Cable,
  Eye,
  EyeOff,
} from "lucide-react";

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
  defaultExpanded = false,
}: NetworkMapLegendProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [activeTab, setActiveTab] = useState<"symbols" | "cables" | "layers">(
    "symbols",
  );

  return (
    <div
      className={cn(
        "absolute bottom-3 left-3 z-[1000] pointer-events-auto w-72 md:w-84 bg-card/95 backdrop-blur-md rounded-xl border border-border/70 shadow-lg text-xs overflow-hidden select-none transition-all duration-200",
        className,
      )}
      data-testid="fixed-map-legend"
    >
      {/* Header Dok Tetap */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border/50">
        <div className="flex items-center gap-2 font-semibold text-foreground text-xs">
          <Layers className="size-3.5 text-primary" />
          <span>Legenda & Lapisan Peta</span>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          data-testid="toggle-legend-collapse"
          className="size-7 sm:size-6 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground transition-colors"
          title={isExpanded ? "Lipat Legenda" : "Buka Legenda Lengkap"}
          aria-label={isExpanded ? "Lipat Legenda" : "Buka Legenda Lengkap"}
        >
          {isExpanded ? (
            <ChevronDown className="size-4 sm:size-3.5" />
          ) : (
            <ChevronUp className="size-4 sm:size-3.5" />
          )}
        </button>
      </div>

      {/* Konten Saat Dilipat (Collapsed State) */}
      {!isExpanded && (
        <div className="flex items-center justify-between px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground">
          <button
            type="button"
            onClick={onToggleCustomers}
            data-testid="toggle-customers-dock"
            title="Klik untuk menyembunyikan/menampilkan pelanggan"
            className={cn(
              "flex items-center gap-1 hover:text-foreground",
              !showCustomers && "opacity-40 line-through",
            )}
          >
            <span className="size-2 rounded-full bg-emerald-500" />
            <span>Pelanggan ({customerCount})</span>
          </button>
          <span className="text-border">|</span>
          <button
            type="button"
            onClick={onToggleInfrastructure}
            data-testid="toggle-infrastructure-dock"
            title="Klik untuk menyembunyikan/menampilkan perangkat"
            className={cn(
              "flex items-center gap-1 hover:text-foreground",
              !showInfrastructure && "opacity-40 line-through",
            )}
          >
            <span className="size-2 rounded-full bg-purple-500" />
            <span>Perangkat ({infraCount})</span>
          </button>
          <span className="text-border">|</span>
          <button
            type="button"
            onClick={onToggleCables}
            data-testid="toggle-cables-dock"
            title="Klik untuk menyembunyikan/menampilkan kabel"
            className={cn(
              "flex items-center gap-1 hover:text-foreground",
              !showCables && "opacity-40 line-through",
            )}
          >
            <span className="w-2.5 h-0.5 bg-cyan-500 rounded" />
            <span>Kabel ({cableCount ?? 0})</span>
          </button>
        </div>
      )}

      {/* Konten Saat Dibuka (Expanded State) */}
      {isExpanded && (
        <div>
          {/* Tab Navigasi Kategori */}
          <div className="flex border-b border-border/40 bg-muted/20">
            <button
              type="button"
              onClick={() => setActiveTab("symbols")}
              data-testid="legend-tab-symbols"
              className={cn(
                "flex-1 min-h-[32px] sm:min-h-[28px] text-[11px] font-medium transition-colors flex items-center justify-center gap-1 border-r border-border/30 last:border-r-0",
                activeTab === "symbols"
                  ? "bg-card text-foreground border-b-2 border-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <MapPin className="size-3" />
              Penanda & Titik
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("cables")}
              data-testid="legend-tab-cables"
              className={cn(
                "flex-1 min-h-[32px] sm:min-h-[28px] text-[11px] font-medium transition-colors flex items-center justify-center gap-1 border-r border-border/30 last:border-r-0",
                activeTab === "cables"
                  ? "bg-card text-foreground border-b-2 border-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Cable className="size-3" />
              Kapasitas Kabel
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("layers")}
              data-testid="legend-tab-layers"
              className={cn(
                "flex-1 min-h-[32px] sm:min-h-[28px] text-[11px] font-medium transition-colors flex items-center justify-center gap-1",
                activeTab === "layers"
                  ? "bg-card text-foreground border-b-2 border-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Layers className="size-3" />
              Visibilitas Lapisan
            </button>
          </div>

          {/* Panel Tab 1: Penanda & Simbol */}
          {activeTab === "symbols" && (
            <div data-testid="marker-legend-symbols" className="p-3 space-y-3">
              {/* Status Pelanggan */}
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Titik Pelanggan
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-emerald-500 shrink-0" />
                    <span>Aktif Normal</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-amber-500 ring-2 ring-amber-400/40 shrink-0" />
                    <span>Redaman Rendah</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-rose-500 ring-2 ring-rose-400/40 shrink-0" />
                    <span>Isolir Tagihan</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-red-600 shrink-0" />
                    <span>Offline / Putus</span>
                  </div>
                </div>
              </div>

              {/* Perangkat Infrastruktur */}
              <div>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Perangkat Infrastruktur Jaringan
                </div>
                <div className="space-y-1 text-[11px]">
                  <div
                    data-testid="infra-legend-router"
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full bg-purple-500 ring-2 ring-purple-300/30 shrink-0" />
                      <span>Core Router Gateway</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      Routing
                    </span>
                  </div>
                  <div
                    data-testid="infra-legend-olt"
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full bg-cyan-500 ring-2 ring-cyan-300/30 shrink-0" />
                      <span>OLT Fiber Terminal</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      GPON/EPON
                    </span>
                  </div>
                  <div
                    data-testid="infra-legend-odc"
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-sm bg-blue-500 shrink-0" />
                      <span>ODC Kabinet Feeder</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      Distribusi
                    </span>
                  </div>
                  <div
                    data-testid="infra-legend-odp"
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-sm bg-amber-500 shrink-0" />
                      <span>ODP Kotak Distribusi</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      Drop
                    </span>
                  </div>
                  <div
                    data-testid="infra-legend-pole"
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-slate-500 shrink-0" />
                      <span>Tiang Tumpu Fiber</span>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      Jalur
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Panel Tab 2: Kapasitas Kabel */}
          {activeTab === "cables" && (
            <div data-testid="cable-legend-details" className="p-3 space-y-2">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Kapasitas & Ketebalan Serat Optik
              </div>
              <div className="space-y-1.5 text-[11px]">
                {/* Tier 1: Backbone */}
                <div
                  data-testid="cable-legend-tier-backbone"
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-[5px] bg-purple-500 rounded-full shrink-0" />
                    <span>Backbone Optik (48 - 96 Core)</span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    5.0px
                  </span>
                </div>

                {/* Tier 2: Feeder Utama */}
                <div
                  data-testid="cable-legend-tier-feeder-main"
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-[4px] bg-indigo-500 rounded-full shrink-0" />
                    <span>Feeder Utama (24 Core)</span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    4.0px
                  </span>
                </div>

                {/* Tier 3: Feeder Distribusi */}
                <div
                  data-testid="cable-legend-tier-feeder-dist"
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-[3px] bg-cyan-500 rounded-full shrink-0" />
                    <span>Feeder Distribusi (16 - 24 Core)</span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    3.2px
                  </span>
                </div>

                {/* Tier 4: Distribusi Cabang */}
                <div
                  data-testid="cable-legend-tier-branch"
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-[2px] bg-amber-500 rounded-full shrink-0" />
                    <span>Distribusi Cabang (4 - 8 Core)</span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    2.5px
                  </span>
                </div>

                {/* Tier 5: Drop Optik */}
                <div
                  data-testid="cable-legend-tier-drop"
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-[1.5px] bg-emerald-500 rounded-full shrink-0" />
                    <span>Drop Optik (1 - 2 Core)</span>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    1.8px
                  </span>
                </div>

                {/* Tier 6: Highlight */}
                <div
                  data-testid="cable-legend-tier-highlight"
                  className="flex items-center justify-between pt-1 border-t border-border/40"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-[3.5px] bg-cyan-400 ring-2 ring-cyan-300/60 animate-pulse rounded-full shrink-0" />
                    <span className="font-medium text-cyan-500">
                      Jalur Disorot (Highlight)
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-cyan-500">
                    +3.5px
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Panel Tab 3: Kontrol Lapisan */}
          {activeTab === "layers" && (
            <div className="p-3 space-y-2">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Saklar Visibilitas Lapisan
              </div>
              <div className="space-y-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={onToggleCustomers}
                  className={cn(
                    "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg border transition-colors",
                    showCustomers
                      ? "bg-primary/5 border-primary/20 text-foreground"
                      : "bg-muted/30 border-transparent text-muted-foreground",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <MapPin className="size-3.5 text-emerald-500" />
                    <span>Titik Pelanggan ({customerCount})</span>
                  </div>
                  {showCustomers ? (
                    <Eye className="size-3.5 text-primary" />
                  ) : (
                    <EyeOff className="size-3.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={onToggleInfrastructure}
                  className={cn(
                    "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg border transition-colors",
                    showInfrastructure
                      ? "bg-primary/5 border-primary/20 text-foreground"
                      : "bg-muted/30 border-transparent text-muted-foreground",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Layers className="size-3.5 text-purple-500" />
                    <span>Perangkat Jaringan ({infraCount})</span>
                  </div>
                  {showInfrastructure ? (
                    <Eye className="size-3.5 text-primary" />
                  ) : (
                    <EyeOff className="size-3.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={onToggleCables}
                  className={cn(
                    "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg border transition-colors",
                    showCables
                      ? "bg-primary/5 border-primary/20 text-foreground"
                      : "bg-muted/30 border-transparent text-muted-foreground",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Cable className="size-3.5 text-cyan-500" />
                    <span>Jalur Kabel Optik ({cableCount ?? 0})</span>
                  </div>
                  {showCables ? (
                    <Eye className="size-3.5 text-primary" />
                  ) : (
                    <EyeOff className="size-3.5" />
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
