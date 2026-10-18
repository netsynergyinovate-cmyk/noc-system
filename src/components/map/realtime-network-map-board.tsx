"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  Boxes,
  Layers,
  MapPin,
  Network,
  Router,
  Server,
  Share2,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NetworkMapLeafletLoader } from "./network-map-leaflet-loader";
import { MapRefreshControl } from "./map-refresh-control";
import { MapEmptyState } from "./map-empty-state";
import { MapErrorState } from "./map-error-state";
import { MapDataSourceIndicator } from "./map-data-source-indicator";
import type { NetworkMapData } from "@/services/network-map.service";

export interface RealtimeNetworkMapBoardProps {
  initialData: NetworkMapData;
  initialFocusId?: string;
  embeddedInPage?: boolean;
}

export function RealtimeNetworkMapBoard({
  initialData,
  initialFocusId,
  embeddedInPage = false,
}: RealtimeNetworkMapBoardProps) {
  const [data, setData] = useState<NetworkMapData>(initialData);
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string>(
    initialData.dataSource.lastSynchronizedAt,
  );
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(30);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Ambil data nyata terbaru dari endpoint /api/map/network
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/map/network", {
        headers: { "Cache-Control": "no-cache" },
      });

      if (!res.ok) {
        throw new Error(`Gagal menyegarkan data peta (HTTP ${res.status})`);
      }

      const json = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.error || "Format respons peta tidak valid");
      }

      startTransition(() => {
        setData(json.data);
        if (json.data?.dataSource?.lastSynchronizedAt) {
          setLastRefreshedAt(json.data.dataSource.lastSynchronizedAt);
        }
      });
    } catch (err) {
      console.error("[MAP_REFRESH_ERROR]", err);
      setErrorMessage(
        err instanceof Error ? err.message : "Terjadi kendala jaringan saat memuat data peta.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Interval penyegaran otomatis berkala (Auto-Refresh 15s/30s/60s/300s jika aktif)
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;

    // Interval berkala: jika 30s maka setInterval(..., 30000)
    const intervalMs = autoRefreshInterval > 0 ? autoRefreshInterval * 1000 : 30000;
    const interval = setInterval(() => {
      handleRefresh();
    }, intervalMs); // Auto-refresh berkala (default 30000 ms)

    return () => clearInterval(interval);
  }, [autoRefreshInterval, handleRefresh]);

  const isEmpty =
    data.customers.length === 0 && data.infrastructure.length === 0;

  const totalDevices =
    data.infrastructure.length ||
    data.summary.totalRouters + data.summary.totalOlts + data.summary.totalOdps;
  const totalRouters = data.summary.totalRouters;
  const totalOlts = data.summary.totalOlts;
  const totalOdps = data.summary.totalOdps;
  const totalGeocodedCustomers = data.summary.geocodedCustomers;

  const formattedTime = lastRefreshedAt
    ? new Date(lastRefreshedAt).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "-";

  if (embeddedInPage) {
    return (
      <div
        className="flex-1 min-h-0 w-full flex flex-col relative overflow-hidden"
        data-testid="realtime-network-map-board"
      >
        {/* Toolbar Interaktif Realtime: Kontrol Auto-Refresh, Status Waktu, Tombol Segarkan */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 border-b bg-card/60 backdrop-blur-md shrink-0 shadow-2xs text-xs">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <span
                className={`size-2 rounded-full ${autoRefreshInterval > 0 ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/60"}`}
              />
              Sinkronisasi Peta Realtime:
            </span>
            <Badge
              variant="secondary"
              className="text-[11px] font-normal text-muted-foreground gap-1 h-5"
              data-testid="last-sync-time"
            >
              <span>Diperbarui:</span>
              <span className="font-semibold text-foreground">{formattedTime}</span>
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <MapRefreshControl
              lastRefreshedAt={lastRefreshedAt}
              isRefreshing={isRefreshing || isPending}
              onRefresh={handleRefresh}
              selectedInterval={autoRefreshInterval}
              onIntervalChange={(newSec) => setAutoRefreshInterval(newSec)}
            />

            <Button
              type="button"
              variant={autoRefreshInterval > 0 ? "default" : "outline"}
              size="sm"
              onClick={() => setAutoRefreshInterval((prev) => (prev > 0 ? 0 : 30))}
              className="h-6 text-xs font-medium gap-1 px-2"
              data-testid="auto-refresh-toggle"
              aria-pressed={autoRefreshInterval > 0}
              title="Aktifkan atau nonaktifkan sinkronisasi otomatis berkala"
            >
              <span>{autoRefreshInterval > 0 ? `Auto (${autoRefreshInterval}s)` : "Auto-Refresh"}</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing || isPending}
              className="sr-only"
              data-testid="refresh-map-button"
              aria-hidden="true"
              tabIndex={-1}
            >
              Segarkan
            </Button>
          </div>
        </div>

        {/* Banner Notifikasi Error / Kegagalan Jaringan */}
        {errorMessage && (
          <div className="p-2 shrink-0">
            <MapErrorState
              errorMessage={errorMessage}
              onRetry={handleRefresh}
              isLoading={isRefreshing || isPending}
            />
          </div>
        )}

        {/* Empty State Banner */}
        {isEmpty && (
          <div className="p-2 shrink-0">
            <MapEmptyState
              totalDevices={totalDevices}
              totalCustomers={data.customers.length}
              totalGeocoded={totalGeocodedCustomers}
            />
          </div>
        )}

        {/* Kanvas Peta Interaktif Leaflet dengan Data Operasional Riil */}
        <div className="flex-1 min-h-0 w-full relative overflow-hidden">
          <NetworkMapLeafletLoader
            initialData={data}
            initialFocusId={initialFocusId}
            className="h-full w-full min-h-0 md:min-h-0 lg:min-h-0 rounded-none border-0 shadow-none"
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex w-full flex-col gap-3.5"
      data-testid="realtime-network-map-board"
    >
      {/* Header Bar Kontrol & Sumber Data Riil */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl text-foreground flex items-center gap-2">
              <Layers className="size-5 text-primary" />
              Peta Peletakan Infrastruktur
            </h1>

            {/* Penanda Sumber Data Aktif: data-testid="data-source-badge" (PostgreSQL Live vs Data Mock Lokal) */}
            <MapDataSourceIndicator
              dataSource={data.dataSource}
              summary={data.summary}
            />

            <Badge
              variant="secondary"
              className="text-[11px] font-normal text-muted-foreground gap-1"
              data-testid="last-sync-time"
            >
              <span>Diperbarui:</span>
              <span className="font-semibold text-foreground">{formattedTime}</span>
            </Badge>
          </div>

          <p className="text-xs text-muted-foreground mt-0.5">
            Monitoring fisik peletakan Core Router BGP, OLT HSGQ, kotak distribusi ODP, dan jalur kabel fiber optik nyata.
          </p>
        </div>

        {/* Tombol Kontrol: Segarkan Data, Auto-Refresh & Navigasi Modul */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Komponen Terpadu: Penanda Waktu, Interval Selector, & Tombol Segarkan */}
          <MapRefreshControl
            lastRefreshedAt={lastRefreshedAt}
            isRefreshing={isRefreshing || isPending}
            onRefresh={handleRefresh}
            selectedInterval={autoRefreshInterval}
            onIntervalChange={(newSec) => setAutoRefreshInterval(newSec)}
          />

          {/* Toggle Auto-Refresh 30s Cepat */}
          <Button
            type="button"
            variant={autoRefreshInterval > 0 ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefreshInterval((prev) => (prev > 0 ? 0 : 30))}
            className="h-8 gap-1.5 text-xs font-medium"
            data-testid="auto-refresh-toggle"
            aria-pressed={autoRefreshInterval > 0}
            title="Aktifkan atau nonaktifkan sinkronisasi otomatis berkala setiap 30 detik"
          >
            <span
              className={`size-2 rounded-full ${autoRefreshInterval > 0 ? "bg-emerald-300 animate-pulse" : "bg-muted-foreground"}`}
            />
            <span>{autoRefreshInterval > 0 ? `Auto (${autoRefreshInterval}s) Aktif` : "Auto-Refresh"}</span>
          </Button>

          {/* Fallback tombol refresh manual kompatibel */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing || isPending}
            className="sr-only"
            data-testid="refresh-map-button"
            aria-hidden="true"
            tabIndex={-1}
          >
            Segarkan
          </Button>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            data-testid="shortcut-router-link"
          >
            <Link href="/app/router" title="Buka manajemen router MikroTik">
              <Router className="size-3.5 text-primary" />
              <span className="hidden sm:inline">Router</span>
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            data-testid="shortcut-cpe-link"
          >
            <Link href="/app/cpe" title="Buka daftar perangkat OLT dan PON">
              <Network className="size-3.5 text-cyan-500" />
              <span className="hidden sm:inline">OLT</span>
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            data-testid="shortcut-customer-map-link"
          >
            <Link href="/app/pelanggan/peta" title="Buka peta sebaran titik pelanggan">
              <Users className="size-3.5 text-emerald-500" />
              <span className="hidden sm:inline">Pelanggan</span>
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            data-testid="shortcut-topology-link"
          >
            <Link href="/app/topologi" title="Buka peta susunan bertingkat Core -> ODC -> ODP -> Pelanggan">
              <Share2 className="size-3.5 text-purple-500 rotate-90" />
              <span className="hidden sm:inline">Hierarki</span>
            </Link>
          </Button>

          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            data-testid="shortcut-cable-map-link"
          >
            <Link href="/app/peta/kabel" title="Buka peta bentangan jalur kabel serat optik">
              <Share2 className="size-3.5 text-cyan-500 rotate-45" />
              <span className="hidden sm:inline">Kabel</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* Banner Notifikasi Error / Kegagalan Jaringan: data-testid="map-error-state" dengan tombol Coba Lagi */}
      {errorMessage && (
        <MapErrorState
          errorMessage={errorMessage}
          onRetry={handleRefresh}
          isLoading={isRefreshing || isPending}
        />
      )}

      {/* Ringkasan Metrik Infrastruktur Nyata */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2.5" data-testid="infra-metrics-grid">
        <Card className="p-3 bg-card/60 backdrop-blur-xs shadow-xs" data-testid="infra-total-devices">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-primary/10 text-primary">
              <Server className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Total Perangkat</p>
              <p className="text-lg font-bold text-foreground leading-none mt-0.5">{totalDevices}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="p-3 bg-card/60 backdrop-blur-xs shadow-xs" data-testid="infra-total-routers">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Router className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Core Router</p>
              <p className="text-lg font-bold text-purple-600 dark:text-purple-400 leading-none mt-0.5">
                {totalRouters}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="p-3 bg-card/60 backdrop-blur-xs shadow-xs" data-testid="infra-total-olts">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
              <Network className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">OLT Fiber HSGQ</p>
              <p className="text-lg font-bold text-cyan-600 dark:text-cyan-400 leading-none mt-0.5">
                {totalOlts}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="p-3 bg-card/60 backdrop-blur-xs shadow-xs" data-testid="infra-total-odps">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Boxes className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Kotak ODP Distribusi</p>
              <p className="text-lg font-bold text-amber-600 dark:text-amber-400 leading-none mt-0.5">
                {totalOdps}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="p-3 bg-card/60 backdrop-blur-xs shadow-xs col-span-2 sm:col-span-1" data-testid="infra-connected-clients">
          <CardContent className="p-0 flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <MapPin className="size-4" />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">Pelanggan Terpetakan</p>
              <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400 leading-none mt-0.5">
                {totalGeocodedCustomers}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Empty State Banner (Jika belum ada data sama sekali di PostgreSQL riil): data-testid="empty-map-state" */}
      {isEmpty && (
        <MapEmptyState
          totalDevices={totalDevices}
          totalCustomers={data.customers.length}
          totalGeocoded={totalGeocodedCustomers}
        />
      )}

      {/* Kanvas Peta Interaktif Leaflet dengan Data Operasional Riil */}
      <div className="flex-1 min-h-[580px] w-full relative rounded-xl border overflow-hidden shadow-xs">
        <NetworkMapLeafletLoader
          initialData={data}
          initialFocusId={initialFocusId}
        />
      </div>
    </div>
  );
}
