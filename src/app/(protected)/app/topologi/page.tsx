import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { readFocusId } from "@/lib/dashboard/map-focus";
import { getNetworkHierarchyData } from "@/services/network-hierarchy.service";
import { HierarchyMapBoard } from "@/components/map/hierarchy-map-board";

export const metadata: Metadata = {
  title: "Peta Susunan Bertingkat Topologi - NOC ISP",
  description:
    "Visualisasi topologi jaringan terstruktur bertingkat Server/Core -> ODC -> ODP -> Pelanggan dengan data nyata dari backend.",
};

export default async function PetaTopologiPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string | string[] }>;
}) {
  await requireSession();
  const focusId = readFocusId((await searchParams).focus);
  const hierarchyData = await getNetworkHierarchyData();

  return (
    <div className="w-full" data-testid="peta-topologi-page">
      <HierarchyMapBoard
        initialData={hierarchyData}
        initialFocusId={focusId ?? undefined}
      />
    </div>
  );
}
