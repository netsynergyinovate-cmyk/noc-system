import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { readFocusId } from "@/lib/dashboard/map-focus";
import { getCableMapData } from "@/services/cable-map.service";
import { CableMapBoard } from "@/components/map/cable-map-board";

export const metadata: Metadata = {
  title: "Peta Jalur Kabel Jaringan - NOC ISP",
  description:
    "Pemetaan geografis bentangan jalur kabel serat optik lapangan: Backbone, Feeder, Distribusi, dan Drop Kabel Pelanggan dengan data nyata dari backend.",
};

export default async function PetaJalurKabelPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string | string[] }>;
}) {
  await requireSession();
  const focusId = readFocusId((await searchParams).focus);
  const cableMapData = await getCableMapData();

  return (
    <div className="w-full" data-testid="peta-jalur-kabel-page">
      <CableMapBoard
        initialData={cableMapData}
        initialFocusId={focusId ?? undefined}
      />
    </div>
  );
}
