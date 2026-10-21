"use client";

import { useEffect, useRef, useState } from "react";
import {
  Search,
  Filter,
  Layers,
  Plus,
  GitBranch,
  HelpCircle,
  RefreshCw,
  ChevronDown,
  Database,
  Cloud,
  PenTool,
} from "lucide-react";

export interface SearchResult {
  id: string;
  type: "server" | "odc" | "odp" | "pole" | "customer";
  name: string;
  detail: string;
  latitude?: number;
  longitude?: number;
}

interface MapControlsProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchResults: SearchResult[];
  onSelectSearchResult: (result: SearchResult) => void;
  statusFilter: string;
  onStatusFilterChange: (s: string) => void;
  regionFilter: string;
  onRegionFilterChange: (r: string) => void;
  availableRegions: string[];
  baseLayer: "satellite" | "streets";
  onBaseLayerChange: (layer: "satellite" | "streets") => void;
  visibleLayers: {
    customers: boolean;
    devices: boolean;
    routes: boolean;
    hierarchyLines: boolean;
    annotations?: boolean;
  };
  onToggleLayer: (layerName: keyof MapControlsProps["visibleLayers"]) => void;
  dataSource: "central-api" | "local-db";
  lastUpdated: string | null;
  autoRefreshStatus?: "active" | "paused" | "disabled";
  onRefresh: () => void;
  isRefreshing: boolean;
  onStartAddCustomer: () => void;
  onStartAddDevice: () => void;
  onStartAddRoute: () => void;
  onToggleTree: () => void;
  onOpenGuide: () => void;
  isAnnotationOpen?: boolean;
  onToggleAnnotation?: () => void;
  /** Menu toolbar dibuka: induk menutup panel samping agar tidak bertumpuk */
  onMenuOpen?: () => void;
  /** Panel samping yang sedang terbuka ("" = tidak ada); berubah = dropdown toolbar ditutup */
  openPanelKey?: string;
}

function formatLastUpdated(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function MapControls({
  searchQuery,
  onSearchChange,
  searchResults,
  onSelectSearchResult,
  statusFilter,
  onStatusFilterChange,
  regionFilter,
  onRegionFilterChange,
  availableRegions,
  baseLayer,
  onBaseLayerChange,
  visibleLayers,
  onToggleLayer,
  dataSource,
  lastUpdated,
  autoRefreshStatus = "active",
  onRefresh,
  isRefreshing,
  onStartAddCustomer,
  onStartAddDevice,
  onStartAddRoute,
  onToggleTree,
  onOpenGuide,
  isAnnotationOpen = false,
  onToggleAnnotation,
  onMenuOpen,
  openPanelKey = "",
}: MapControlsProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [showLayers, setShowLayers] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  // Panel samping baru terbuka: tutup dropdown toolbar (hanya satu yang terbuka)
  const [prevPanelKey, setPrevPanelKey] = useState(openPanelKey);
  if (prevPanelKey !== openPanelKey) {
    setPrevPanelKey(openPanelKey);
    if (openPanelKey) {
      setShowFilters(false);
      setShowLayers(false);
      setShowAddMenu(false);
    }
  }

  // Panel samping mulai tepat di bawah toolbar, walau toolbar terlipat jadi dua baris
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const update = () =>
      document.documentElement.style.setProperty(
        "--map-toolbar-bottom",
        `${Math.ceil(el.getBoundingClientRect().bottom)}px`,
      );
    const observer = new ResizeObserver(update);
    observer.observe(el);
    update();
    return () => observer.disconnect();
  }, []);

  // Buka satu menu: menu lain dan panel samping ditutup
  const openOnly = (menu: "filters" | "layers" | "add", open: boolean) => {
    setShowFilters(menu === "filters" && open);
    setShowLayers(menu === "layers" && open);
    setShowAddMenu(menu === "add" && open);
    if (open) onMenuOpen?.();
  };

  const lastUpdatedTime = formatLastUpdated(lastUpdated);

  return (
    <div ref={barRef} className="absolute top-3 inset-x-3 z-[990] pointer-events-none flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {/* Sisi Kiri: Navigasi & Pencarian */}
        <div className="flex items-center gap-2 pointer-events-auto flex-wrap">

          {/* Kolom Pencarian */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Cari pelanggan / perangkat..."
              aria-label="Cari pelanggan, nomor, SN ONU, atau perangkat"
              className="bg-card/95 backdrop-blur-md border border-border rounded-xl pl-8 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground w-44 sm:w-64 shadow-lg focus:ring-1 focus:ring-primary outline-none"
            />
            {searchResults.length > 0 && (
              <ul className="absolute left-0 top-full mt-1 w-64 max-w-[calc(100vw-1.5rem)] max-h-72 overflow-y-auto bg-card/95 backdrop-blur-md border border-border rounded-xl shadow-xl p-1 z-[1000]">
                {searchResults.map((r) => (
                  <li key={`${r.type}:${r.id}`}>
                    <button
                      type="button"
                      onClick={() => onSelectSearchResult(r)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-muted text-xs"
                    >
                      <span className="block font-medium text-foreground truncate">
                        {r.name}
                      </span>
                      <span className="block text-[10px] text-muted-foreground truncate">
                        {r.detail}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Tombol Filter */}
          <div className="relative">
            <button
              onClick={() => openOnly("filters", !showFilters)}
              className={`p-2 rounded-xl border backdrop-blur-md text-xs font-medium shadow-lg transition-colors flex items-center gap-1.5 ${
                statusFilter || regionFilter
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card/95 border-border text-foreground hover:bg-muted"
              }`}
              title="Saring Wilayah & Status"
            >
              <Filter className="w-4 h-4" />
              <span className="hidden sm:inline">Saring</span>
            </button>

            {showFilters && (
              <div className="absolute left-0 mt-2 w-64 bg-card/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl p-3 z-50 text-xs space-y-3 animate-in fade-in duration-150">
                <div className="flex items-center justify-between border-b border-border pb-1.5 font-semibold text-foreground">
                  <span>Saring Titik Peta</span>
                  {(statusFilter || regionFilter) && (
                    <button
                      onClick={() => {
                        onStatusFilterChange("");
                        onRegionFilterChange("");
                      }}
                      className="text-[10px] text-primary hover:underline font-normal"
                    >
                      Reset
                    </button>
                  )}
                </div>

                <div>
                  <label className="text-[10px] font-medium text-muted-foreground block mb-1">
                    Status Layanan
                  </label>
                  <select
                    value={statusFilter}
                    onChange={(e) => onStatusFilterChange(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-2 py-1 text-xs outline-none"
                  >
                    <option value="">Semua Status</option>
                    <option value="terhubung">Terhubung (Normal)</option>
                    <option value="isolir">Isolir (Billing)</option>
                    <option value="loss">Loss (Gangguan)</option>
                    <option value="offline">Offline</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-medium text-muted-foreground block mb-1">
                    Wilayah / Sektor
                  </label>
                  <select
                    value={regionFilter}
                    onChange={(e) => onRegionFilterChange(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-2 py-1 text-xs outline-none"
                  >
                    <option value="">Semua Wilayah</option>
                    {availableRegions.map((reg) => (
                      <option key={reg} value={reg}>
                        {reg}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sisi Kanan: Sumber Data, Lapisan, Tambah, Relasi, Panduan */}
        <div className="flex items-center gap-2 pointer-events-auto flex-wrap">
          {/* Badge Sumber Data & Status Auto-Refresh */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-card/95 backdrop-blur-md border border-border text-[11px] shadow-lg">
            <div className="flex items-center gap-1.5">
              {dataSource === "central-api" ? (
                <Cloud className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              ) : (
                <Database className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              )}
              <span className="font-medium text-foreground">
                {dataSource === "central-api" ? "Data NOC + koreksi peta" : "DB lokal peta"}
              </span>
            </div>

            {lastUpdatedTime && (
              <>
                <span className="text-border">|</span>
                <span className="text-[10px] text-muted-foreground hidden sm:inline">
                  Diperbarui {lastUpdatedTime}
                </span>
                <span className="text-[10px] text-muted-foreground sm:hidden">
                  {lastUpdatedTime}
                </span>
              </>
            )}

            {/* Indikator Visual Status Auto-Refresh */}
            <div
              className="flex items-center gap-1 pl-0.5"
              title={
                autoRefreshStatus === "active"
                  ? "Auto-refresh aktif (tiap 60 detik)"
                  : autoRefreshStatus === "paused"
                    ? "Auto-refresh ditangguhkan (mode interaksi/edit aktif)"
                    : "Auto-refresh dihentikan (kesalahan konfigurasi/kunci)"
              }
            >
              {autoRefreshStatus === "active" ? (
                <span className="relative flex h-2 w-2" aria-label="Auto-refresh aktif">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
              ) : autoRefreshStatus === "paused" ? (
                <span
                  className="inline-flex rounded-full h-2 w-2 bg-amber-500"
                  aria-label="Auto-refresh ditangguhkan"
                />
              ) : (
                <span
                  className="inline-flex rounded-full h-2 w-2 bg-destructive"
                  aria-label="Auto-refresh nonaktif"
                />
              )}
            </div>

            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors ml-0.5"
              title={
                lastUpdatedTime
                  ? `Segarkan Data Peta (Terakhir: ${lastUpdatedTime})`
                  : "Segarkan Data Peta"
              }
            >
              <RefreshCw
                className={`w-3 h-3 ${isRefreshing ? "animate-spin text-primary" : ""}`}
              />
            </button>
          </div>

          {/* Menu Lapisan Peta */}
          <div className="relative">
            <button
              onClick={() => openOnly("layers", !showLayers)}
              className="p-2 rounded-xl bg-card/95 backdrop-blur-md border border-border text-foreground hover:bg-muted shadow-lg transition-colors flex items-center gap-1.5 text-xs font-medium"
              title="Pilihan Lapis Peta"
            >
              <Layers className="w-4 h-4 text-primary" />
              <span className="hidden md:inline">Lapisan</span>
            </button>

            {showLayers && (
              <div className="absolute right-0 mt-2 w-56 bg-card/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl p-3 z-50 text-xs space-y-3 animate-in fade-in duration-150">
                <div className="font-semibold text-foreground border-b border-border pb-1.5">
                  Peta Dasar & Objek
                </div>

                <div>
                  <label className="text-[10px] font-medium text-muted-foreground block mb-1">
                    Mode Peta Dasar
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => onBaseLayerChange("satellite")}
                      className={`px-2 py-1 rounded-lg text-center font-medium border text-xs ${
                        baseLayer === "satellite"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Satelit
                    </button>
                    <button
                      onClick={() => onBaseLayerChange("streets")}
                      className={`px-2 py-1 rounded-lg text-center font-medium border text-xs ${
                        baseLayer === "streets"
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      Jalan
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5 pt-1 border-t border-border">
                  <label className="text-[10px] font-medium text-muted-foreground block mb-1">
                    Tampilkan Objek
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleLayers.customers}
                      onChange={() => onToggleLayer("customers")}
                      className="rounded text-primary focus:ring-primary"
                    />
                    <span>Titik Pelanggan</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleLayers.devices}
                      onChange={() => onToggleLayer("devices")}
                      className="rounded text-primary focus:ring-primary"
                    />
                    <span>Perangkat (Server/ODC/ODP)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleLayers.routes}
                      onChange={() => onToggleLayer("routes")}
                      className="rounded text-primary focus:ring-primary"
                    />
                    <span>Jalur Kabel Nyata</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleLayers.hierarchyLines}
                      onChange={() => onToggleLayer("hierarchyLines")}
                      className="rounded text-primary focus:ring-primary"
                    />
                    <span>Garis Relasi Induk-Anak</span>
                  </label>
                  {visibleLayers.annotations !== undefined && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={visibleLayers.annotations}
                        onChange={() => onToggleLayer("annotations")}
                        className="rounded text-primary focus:ring-primary"
                      />
                      <span>Lapisan Gambar / Anotasi</span>
                    </label>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Tombol Pohon Relasi */}
          <button
            onClick={onToggleTree}
            className="p-2 rounded-xl bg-card/95 backdrop-blur-md border border-border text-foreground hover:bg-muted shadow-lg transition-colors flex items-center gap-1.5 text-xs font-medium"
            title="Buka Pohon Relasi Bertingkat"
          >
            <GitBranch className="w-4 h-4 text-primary" />
            <span className="hidden md:inline">Relasi</span>
          </button>

          {/* Tombol Lapisan Gambar / Anotasi */}
          {onToggleAnnotation && (
            <button
              onClick={onToggleAnnotation}
              className={`p-2 rounded-xl border backdrop-blur-md text-xs font-medium shadow-lg transition-colors flex items-center gap-1.5 ${
                isAnnotationOpen
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card/95 border-border text-foreground hover:bg-muted"
              }`}
              title="Kelola Lapisan Gambar & Anotasi"
            >
              <PenTool
                className={`w-4 h-4 ${
                  isAnnotationOpen ? "text-primary-foreground" : "text-primary"
                }`}
              />
              <span className="hidden md:inline">Anotasi</span>
            </button>
          )}

          {/* Menu Tambah (Progressive Disclosure) */}
          <div className="relative">
            <button
              onClick={() => openOnly("add", !showAddMenu)}
              className="px-3 py-2 rounded-xl bg-primary text-primary-foreground font-medium shadow-lg hover:opacity-90 transition-opacity flex items-center gap-1.5 text-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Tambah</span>
              <ChevronDown className="w-3 h-3" />
            </button>

            {showAddMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-card/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl p-1.5 z-50 text-xs space-y-1 animate-in fade-in duration-150">
                <button
                  onClick={() => {
                    setShowAddMenu(false);
                    onStartAddCustomer();
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-muted text-foreground transition-colors flex items-center gap-2 font-medium"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  + Hubungkan Pelanggan
                </button>
                <button
                  onClick={() => {
                    setShowAddMenu(false);
                    onStartAddDevice();
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-muted text-foreground transition-colors flex items-center gap-2 font-medium"
                >
                  <span className="w-2 h-2 rounded-full bg-indigo-500" />
                  + Perangkat Jaringan
                </button>
                <button
                  onClick={() => {
                    setShowAddMenu(false);
                    onStartAddRoute();
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-muted text-foreground transition-colors flex items-center gap-2 font-medium"
                >
                  <span className="w-2 h-2 rounded-full bg-orange-500" />
                  + Rute Jalur Kabel
                </button>
              </div>
            )}
          </div>

          {/* Panduan Peta */}
          <button
            onClick={onOpenGuide}
            className="p-2 rounded-xl bg-card/95 backdrop-blur-md border border-border text-foreground hover:bg-muted shadow-lg transition-colors"
            title="Panduan Membaca Peta"
          >
            <HelpCircle className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>
    </div>
  );
}
