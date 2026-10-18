import type { Metadata } from "next";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { DeploySafetyPanel } from "@/components/dashboard/deploy-safety-panel";
import { PageTipsPanel } from "@/components/dashboard/page-tips-panel";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Pengaman Deploy & Kesiapan Rilis - NOC ISP",
};

export default async function DeploySafetyPage() {
  await requireSession();

  return (
    <div
      data-testid="deploy-safety-page"
      className="flex w-full flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Pengaman Deploy & Kesiapan Rilis
          </h1>
          <MockDataNotice source="health check engine & snapshot cadangan" />
        </div>
        <p className="text-sm text-muted-foreground">
          Pemeriksaan kesehatan sistem (health check), titik cadangan & snapshot, pre-flight checklist, serta proteksi rollback otomatis.
        </p>
      </div>

      <PageTipsPanel />

      <DeploySafetyPanel />
    </div>
  );
}
