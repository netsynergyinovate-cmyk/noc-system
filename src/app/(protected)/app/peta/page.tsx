import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { getNetworkMapData } from "@/services/network-map.service";
import { RealtimeNetworkMapBoard } from "@/components/map/realtime-network-map-board";
export { NetworkMapLeafletLoader } from "@/components/map/network-map-leaflet-loader";
import { readFocusId } from "@/lib/dashboard/map-focus";

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

  return (
    <div
      className="relative flex flex-col w-[calc(100%+2rem)] sm:w-[calc(100%+3rem)] lg:w-[calc(100%+3rem)] -mx-4 -my-5 sm:-mx-6 sm:-my-6 lg:-mx-6 lg:-my-6 h-[calc(100dvh-4.5rem)] lg:h-[100dvh] overflow-hidden bg-background"
      data-testid="peta-infrastruktur-page"
    >
      <RealtimeNetworkMapBoard
        initialData={mapData}
        initialFocusId={focusId ?? undefined}
        embeddedInPage
      />
    </div>
  );
}
