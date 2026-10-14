// Logika evaluasi gerbang penahanan fungsi utama (Config Gatekeeper).
// Menahan fungsi monitoring & analisis bila konfigurasi router wajib belum lulus.
// Murni (tanpa server-only agar mudah diuji).

export interface OnboardingGateState {
  isLocked: boolean;
  status: "lulus" | "ditahan";
  reason: string;
  mandatoryDevice: "router";
  unlockedPaths: readonly string[];
  bannerNotice: string;
}

export const ONBOARDING_GATE_UNLOCKED_PATHS: readonly string[] = [
  "/setup",
  "/app/onboarding",
  "/app/router",
  "/app/pengaturan/perangkat",
  "/app/pengaturan",
];

/**
 * Mengevaluasi apakah gerbang penahanan fungsi utama aktif.
 */
export function evaluateOnboardingGate(options: {
  hasConnectedRouter?: boolean;
  isLiveMode?: boolean;
  forceLocked?: boolean;
}): OnboardingGateState {
  const { hasConnectedRouter = false, isLiveMode = false, forceLocked = false } = options;

  // Gerbang menahan fungsi utama jika:
  // 1. forceLocked disetel eksplisit, ATAU
  // 2. Dalam mode live dan belum ada router MikroTik yang terhubung aktif
  const isLocked = forceLocked || (isLiveMode && !hasConnectedRouter);

  if (isLocked) {
    return {
      isLocked: true,
      status: "ditahan",
      reason:
        "Fungsi utama dasbor, alert, dan analisis ditahan karena Router MikroTik wajib belum terhubung atau belum lulus uji koneksi.",
      mandatoryDevice: "router",
      unlockedPaths: ONBOARDING_GATE_UNLOCKED_PATHS,
      bannerNotice:
        "Gerbang Konfigurasi Aktif: Fungsi utama ditahan hingga konfigurasi Router MikroTik selesai dan terverifikasi.",
    };
  }

  return {
    isLocked: false,
    status: "lulus",
    reason: "Konfigurasi perangkat wajib telah lulus. Seluruh fungsi operasional terbuka.",
    mandatoryDevice: "router",
    unlockedPaths: ONBOARDING_GATE_UNLOCKED_PATHS,
    bannerNotice: "",
  };
}

/**
 * Memeriksa apakah sebuah rute href dikecualikan dari penahanan (tetap bisa dibuka saat gerbang aktif).
 */
export function isPathExemptFromGate(
  href: string | undefined,
  unlockedPaths: readonly string[] = ONBOARDING_GATE_UNLOCKED_PATHS,
): boolean {
  if (!href) return false;
  return unlockedPaths.some((p) => href === p || href.startsWith(`${p}/`));
}
