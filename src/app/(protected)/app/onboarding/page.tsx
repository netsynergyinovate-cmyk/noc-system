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
      className="flex w-full flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Pusat Onboarding & Tutorial Wajib
          </h1>
          <MockDataNotice source="alur onboarding & panduan tutorial" />
        </div>
        <p className="text-sm text-muted-foreground">
          Panduan terstruktur menjalankan aplikasi dari nol, gerbang konfigurasi perangkat wajib, serta modul integrasi bertahap hingga siap go-live.
        </p>
      </div>

      <PageTipsPanel />

      <OnboardingCenterBoard />
    </div>
  );
}
