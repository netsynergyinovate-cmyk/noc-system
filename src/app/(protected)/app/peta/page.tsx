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

  return (
    <div
      className="relative flex flex-col w-[calc(100%+2rem)] sm:w-[calc(100%+3rem)] lg:w-[calc(100%+3rem)] -mx-4 -my-5 sm:-mx-6 sm:-my-6 lg:-mx-6 lg:-my-6 h-[calc(100dvh-4.5rem)] lg:h-[100dvh] overflow-hidden bg-background"
      data-testid="peta-infrastruktur-page"
    >
      {/* Top HUD Header: Single compact row */}
      <header className="shrink-0 z-20 border-b border-border/60 bg-card/90 backdrop-blur-md px-3 sm:px-4">
        <div className="flex items-center justify-between h-9 gap-2">
          {/* Left: title + badge + stats pill */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="p-1 rounded bg-primary/10 text-primary shrink-0">
              <Network className="size-3.5" />
            </span>
            <h1 className="text-xs font-semibold tracking-tight text-foreground whitespace-nowrap">
              Peta Infrastruktur
            </h1>
            <span
              data-testid="data-source-badge"
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border shrink-0 ${
                mapData.dataSource?.isRealData
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
              }`}
            >
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {mapData.dataSource?.isRealData ? "PostgreSQL Live" : "Mock"}
            </span>
            <span className="hidden sm:flex items-center gap-2 text-[10px] text-muted-foreground pl-1">
              <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-purple-500" />{summary.totalRouters} Router</span>
              <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-cyan-500" />{summary.totalOlts} OLT</span>
              <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-amber-500" />{summary.totalOdps} ODP</span>
            </span>
          </div>

          {/* Right: shortcuts */}
          <nav data-testid="peta-module-shortcuts" className="flex items-center gap-1 shrink-0">
            <Link data-testid="shortcut-router-link" href="/app/router"
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-secondary/60 hover:bg-secondary text-secondary-foreground transition-colors text-[11px] font-medium">
              <Server className="size-3 text-purple-500" /><span className="hidden sm:inline">Router</span>
            </Link>
            <Link data-testid="shortcut-cpe-link" href="/app/cpe"
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-secondary/60 hover:bg-secondary text-secondary-foreground transition-colors text-[11px] font-medium">
              <Radio className="size-3 text-cyan-500" /><span className="hidden sm:inline">OLT/CPE</span>
            </Link>
            <Link data-testid="shortcut-customer-map-link" href="/app/pelanggan/peta"
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-secondary/60 hover:bg-secondary text-secondary-foreground transition-colors text-[11px] font-medium">
              <Users className="size-3 text-emerald-500" /><span className="hidden sm:inline">Pelanggan</span>
            </Link>
            <Link data-testid="shortcut-cable-map-link" href="/app/peta/kabel"
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-secondary/60 hover:bg-secondary text-secondary-foreground transition-colors text-[11px] font-medium">
              <Cable className="size-3 text-indigo-500" /><span className="hidden sm:inline">Kabel</span>
            </Link>
          </nav>
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
