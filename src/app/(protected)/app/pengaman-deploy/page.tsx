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
      className="mx-auto flex max-w-7xl flex-col gap-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Pengaman Deploy & Kesiapan Rilis
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Pemeriksaan kesehatan sistem (health check), titik cadangan & snapshot, pre-flight checklist, serta proteksi rollback otomatis.
          </p>
        </div>
        <MockDataNotice source="health check engine & snapshot cadangan" />
      </div>

      <PageTipsPanel />

      <DeploySafetyPanel />
    </div>
  );
}
