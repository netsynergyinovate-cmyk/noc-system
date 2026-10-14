import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/dashboard/app-shell";
import { AlertSoundController } from "@/components/dashboard/alert-sound-controller";
import { ConfigurationGateBanner } from "@/components/dashboard/configuration-gate-banner";
import { DashboardFeed } from "@/components/dashboard/dashboard-feed";
import { RouterHealthBanner } from "@/components/dashboard/router-health-banner";
import { env } from "@/lib/env";
import { evaluateOnboardingGate, isPathExemptFromGate } from "@/lib/dashboard/onboarding-gate";
import { NEXT_PATH_HEADER } from "@/lib/route-guard";
import { requireSession } from "@/lib/session";
import { hasConnectedDevice } from "@/services/devices.service";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireSession();
  const hasConnected = await hasConnectedDevice();
  const gateState = evaluateOnboardingGate({
    hasConnectedRouter: hasConnected,
    isLiveMode: env.DASHBOARD_DATA === "live",
  });

  const reqHeaders = await headers();
  const currentPath = reqHeaders.get(NEXT_PATH_HEADER) || "";
  const isExempt = isPathExemptFromGate(currentPath);

  // Gerbang onboarding: hanya rute pemantauan operasional yang dialihkan ke /setup jika belum ada perangkat.
  // Rute konfigurasi (onboarding, router, pengaturan) dikecualikan agar pengguna bisa mengisi perangkat!
  if (env.DASHBOARD_DATA === "live" && !hasConnected && !isExempt)
    redirect("/setup");

  return (
    <AppShell user={{ email: user.email }} locked={gateState.isLocked}>
      {/* Satu sambungan data untuk semua halaman aplikasi. */}
      <DashboardFeed />
      {/* Bunyi gangguan baru, terdengar di halaman mana pun yang dibuka. */}
      <AlertSoundController />
      {/* Router tidak terbaca = data beku; harus terlihat di halaman mana pun. */}
      <RouterHealthBanner />
      {gateState.isLocked && (
        <div className="mb-6">
          <ConfigurationGateBanner reason={gateState.reason} />
        </div>
      )}
      {children}
    </AppShell>
  );
}
