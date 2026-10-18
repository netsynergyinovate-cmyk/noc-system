import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { getNetworkMapData } from "@/services/network-map.service";
import { RealtimeNetworkMapBoard } from "@/components/map/realtime-network-map-board";
export { NetworkMapLeafletLoader } from "@/components/map/network-map-leaflet-loader";
import { readFocusId } from "@/lib/dashboard/map-focus";
import { 
  Network, 
  Server, 
  Radio, 
  Users, 
  Cable, 
} from "lucide-react";

export const metadata: Metadata = {
  title: "Peta Infrastruktur & Topologi Jaringan - NOC ISP",
  description:
    "Pemetaan geografis peletakan infrastruktur jaringan Core Router, OLT HSGQ, ODP, dan jalur kabel serat optik lapangan.",
};

export default async function PetaInfrastrukturPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string | string[] }>;
}) {
  await requireSession();
  const focusId = readFocusId((await searchParams).focus);

  let mapData;
  try {
    mapData = await getNetworkMapData();
  } catch (err) {
    console.error("[PETA_MAIN_LOAD_ERROR]", err);
    mapData = {
      customers: [],
      infrastructure: [],
      summary: {
        totalCustomers: 0,
        geocodedCustomers: 0,
        onlineCustomers: 0,
        offlineCustomers: 0,
        criticalOpticsCount: 0,
        totalOlts: 0,
        totalRouters: 0,
        totalOdps: 0,
      },
      dataSource: {
        provider: "PostgreSQL Live (Fallback)",
        isRealData: true,
        lastSynchronizedAt: new Date().toISOString(),
      },
    };
  }

  const summary = mapData.summary || {
    totalCustomers: 0,
    geocodedCustomers: 0,
    onlineCustomers: 0,
    offlineCustomers: 0,
    criticalOpticsCount: 0,
    totalOlts: 0,
    totalRouters: 0,
    totalOdps: 0,
  };

  const totalDevices =
    (summary.totalRouters || 0) +
    (summary.totalOlts || 0) +
    (summary.totalOdps || 0);

  return (
    <div
      className="relative flex flex-col w-[calc(100%+2rem)] sm:w-[calc(100%+3rem)] lg:w-[calc(100%+3rem)] -mx-4 -my-5 sm:-mx-6 sm:-my-6 lg:-mx-6 lg:-my-6 h-[calc(100dvh-4.5rem)] lg:h-[100dvh] overflow-hidden bg-background"
      data-testid="peta-infrastruktur-page"
    >
      {/* Top HUD Header: Compact Zero-Scroll Bar */}
      <header className="shrink-0 z-20 border-b border-border/60 bg-card/90 backdrop-blur-md px-3 py-1.5 sm:px-4 sm:py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Left Title & Status */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded bg-primary/10 text-primary">
                <Network className="size-4" />
              </span>
              <h1 className="text-xs sm:text-sm font-semibold tracking-tight text-foreground">
                Peta Infrastruktur
              </h1>
            </div>

            <span
              data-testid="data-source-badge"
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                mapData.dataSource?.isRealData
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
              }`}
            >
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {mapData.dataSource?.isRealData ? "PostgreSQL Live" : "Data Mock Lokal"}
            </span>
          </div>

          {/* Module Shortcuts */}
          <nav
            data-testid="peta-module-shortcuts"
            className="flex items-center gap-1 text-[11px]"
          >
            <Link
              data-testid="shortcut-router-link"
              href="/app/router"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/60 hover:bg-secondary text-secondary-foreground transition-colors font-medium text-[11px]"
            >
              <Server className="size-3 text-purple-500" />
              <span>Router</span>
            </Link>
            <Link
              data-testid="shortcut-cpe-link"
              href="/app/cpe"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/60 hover:bg-secondary text-secondary-foreground transition-colors font-medium text-[11px]"
            >
              <Radio className="size-3 text-cyan-500" />
              <span>OLT/CPE</span>
            </Link>
            <Link
              data-testid="shortcut-customer-map-link"
              href="/app/pelanggan/peta"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/60 hover:bg-secondary text-secondary-foreground transition-colors font-medium text-[11px]"
            >
              <Users className="size-3 text-emerald-500" />
              <span>Pelanggan</span>
            </Link>
            <Link
              data-testid="shortcut-cable-map-link"
              href="/app/peta/kabel"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/60 hover:bg-secondary text-secondary-foreground transition-colors font-medium text-[11px]"
            >
              <Cable className="size-3 text-indigo-500" />
              <span>Kabel</span>
            </Link>
          </nav>
        </div>

        {/* Metrics Grid: Responsive grid */}
        <div
          data-testid="infra-metrics-grid"
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-5 gap-1.5 sm:gap-2 mt-1.5 pt-1.5 border-t border-border/40 text-[10px] sm:text-xs"
        >
          <div
            data-testid="infra-total-devices"
            className="flex items-center justify-between px-2 py-0.5 rounded bg-muted/40"
          >
            <span className="text-muted-foreground">Total Perangkat</span>
            <span className="font-semibold text-foreground">{totalDevices}</span>
          </div>
          <div
            data-testid="infra-total-routers"
            className="flex items-center justify-between px-2 py-0.5 rounded bg-muted/40"
          >
            <span className="text-muted-foreground flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-purple-500" /> Core Router
            </span>
            <span className="font-semibold text-foreground">{summary.totalRouters}</span>
          </div>
          <div
            data-testid="infra-total-olts"
            className="flex items-center justify-between px-2 py-0.5 rounded bg-muted/40"
          >
            <span className="text-muted-foreground flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-cyan-500" /> OLT Fiber
            </span>
            <span className="font-semibold text-foreground">{summary.totalOlts}</span>
          </div>
          <div
            data-testid="infra-total-odps"
            className="flex items-center justify-between px-2 py-0.5 rounded bg-muted/40"
          >
            <span className="text-muted-foreground flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-amber-500" /> ODP Kotak
            </span>
            <span className="font-semibold text-foreground">{summary.totalOdps}</span>
          </div>
          <div
            data-testid="infra-connected-clients"
            className="flex items-center justify-between px-2 py-0.5 rounded bg-muted/40"
          >
            <span className="text-muted-foreground flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-emerald-500" /> Klien Terhubung
            </span>
            <span className="font-semibold text-foreground">
              {summary.geocodedCustomers ?? summary.totalCustomers}
            </span>
          </div>
        </div>
      </header>

      {/* Main Map Container: Takes exact remaining viewport height */}
      <div className="flex-1 min-h-0 w-full flex flex-col relative overflow-hidden">
        <RealtimeNetworkMapBoard
          initialData={mapData}
          initialFocusId={focusId ?? undefined}
          embeddedInPage
        />
      </div>
    </div>
  );
}
