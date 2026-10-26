import { evaluateOnboardingGate } from "@/lib/dashboard/onboarding-gate";
import { getOnboardingMikrotikStatus } from "@/services/onboarding-mikrotik.service";
import { hasConnectedDevice } from "@/services/devices.service";

export interface ConfigurationBadgeSummary {
  incomplete: boolean;
  status: "selesai" | "belum-selesai";
  label: "Konfigurasi Selesai" | "Konfigurasi Belum Selesai";
  isGateLocked: boolean;
  isLiveMode: boolean;
  hasConnectedRouter: boolean;
  mandatoryDevice: "router";
  redirectUrl: "/setup";
  notice: string;
  checkedAt: string;
}

/**
 * Mengambil ringkasan status kelengkapan konfigurasi untuk lencana (badge) di header/sidebar.
 */
export async function getConfigurationBadgeSummary(): Promise<ConfigurationBadgeSummary> {
  const isLive =
    process.env.DASHBOARD_DATA === "live" ||
    process.env.DATA_MODE === "live" ||
    process.env.DATA_MODE === "nyata";

  let hasConnected = false;
  try {
    hasConnected = await hasConnectedDevice();
  } catch {
    // Database belum aktif
  }

  // Jika router belum terdeteksi dari database, periksa status env MikroTik
  if (!hasConnected) {
    try {
      const mikrotikStatus = await getOnboardingMikrotikStatus();
      if (mikrotikStatus.configured) {
        hasConnected = true;
      }
    } catch {
      // Abaikan
    }
  }

  const gateState = evaluateOnboardingGate({
    hasConnectedRouter: hasConnected,
    isLiveMode: isLive,
  });

  // Konfigurasi dianggap belum selesai bila belum ada router yang terhubung aktif nyata atau gerbang onboarding terkunci
  const incomplete = !hasConnected || gateState.isLocked;

  return {
    incomplete,
    status: incomplete ? "belum-selesai" : "selesai",
    label: incomplete ? "Konfigurasi Belum Selesai" : "Konfigurasi Selesai",
    isGateLocked: gateState.isLocked,
    isLiveMode: isLive,
    hasConnectedRouter: hasConnected,
    mandatoryDevice: "router",
    redirectUrl: "/setup",
    notice: incomplete
      ? "Konfigurasi router wajib belum lengkap. Klik untuk membuka Konfigurasi Router."
      : "Konfigurasi perangkat wajib telah selesai dan terverifikasi.",
    checkedAt: new Date().toISOString(),
  };
}
