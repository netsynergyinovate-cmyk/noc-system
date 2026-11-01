import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { evaluateDeployAccess } from "@/lib/deploy/role-guard";
import { getFeatureMarkerById } from "@/services/feature-markers.service";
import { DeployMarkerDetailView } from "@/components/dashboard/deploy-marker-detail-view";
import type { FeatureMarkerItem } from "@/components/dashboard/deploy-user-markers-tab";

export const dynamic = "force-dynamic";

export default async function DeployMarkerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requirePermission({ system: ["manage"] });
  const reqHeaders = await headers();
  const host = reqHeaders.get("x-forwarded-host") || reqHeaders.get("host");
  const checkReq = new Request(`http://${host || "localhost"}/app/deploy`, {
    headers: reqHeaders,
  });

  const guard = evaluateDeployAccess(checkReq, user.role);
  if (guard.status === 404) {
    notFound();
  }

  if (guard.status === 403) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-destructive">
          <h1 className="text-xl font-bold">Akses Deploy Ditolak</h1>
          <p className="mt-2 text-sm">
            {guard.error ||
              "Halaman deploy hanya diizinkan dibuka melalui loopback localhost atau oleh peran Developer."}
          </p>
        </div>
      </div>
    );
  }

  const { id } = await params;
  const markerRow = await getFeatureMarkerById(id);
  if (!markerRow) {
    notFound();
  }

  // Transform date to ISO string for client component props
  const marker: FeatureMarkerItem = {
    ...markerRow,
    category: markerRow.category as FeatureMarkerItem["category"],
    frequency: markerRow.frequency as FeatureMarkerItem["frequency"],
    status: markerRow.status as FeatureMarkerItem["status"],
    createdAt: markerRow.createdAt.toISOString(),
    updatedAt: markerRow.updatedAt.toISOString(),
  };

  return <DeployMarkerDetailView marker={marker} />;
}
