import type { Metadata } from "next";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { OnboardingCenterBoard } from "@/components/dashboard/onboarding-center-board";
import { PageTipsPanel } from "@/components/dashboard/page-tips-panel";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Pusat Onboarding & Tutorial Wajib - NOC ISP",
};

export default async function OnboardingPage() {
  await requireSession();

  return (
    <div
      data-testid="onboarding-page"
      className="mx-auto flex max-w-7xl flex-col gap-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Pusat Onboarding & Tutorial Wajib
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Panduan terstruktur menjalankan aplikasi dari nol, gerbang konfigurasi perangkat wajib, serta modul integrasi bertahap hingga siap go-live.
          </p>
        </div>
        <MockDataNotice source="alur onboarding & panduan tutorial" />
      </div>

      <PageTipsPanel />

      <OnboardingCenterBoard />
    </div>
  );
}
