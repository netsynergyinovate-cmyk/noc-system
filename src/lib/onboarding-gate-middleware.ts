import {
  evaluateOnboardingGate,
  type OnboardingGateState,
} from "./dashboard/onboarding-gate";

export interface GateEnforcementOptions {
  isLiveMode?: boolean;
  hasConnectedRouter?: boolean;
  forceLocked?: boolean;
}

export const EXEMPT_PATH_PREFIXES: readonly string[] = [
  "/setup",
  "/app/onboarding",
  "/app/router",
  "/app/pengaturan",
  "/api/auth",
  "/api/onboarding",
  "/api/routers",
  "/api/devices",
  "/api/config",
  "/api/deploy",
  "/api/health",
  "/_next",
  "/favicon.ico",
];

/**
 * Memeriksa apakah URL path dikecualikan dari pemblokiran gerbang konfigurasi.
 */
export function isPathExempt(pathname: string): boolean {
  return EXEMPT_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Middleware penegakan gerbang konfigurasi wajib (Config Gatekeeper).
 * Menahan akses ke fungsi operasional utama bila router MikroTik belum lulus.
 * Mengembalikan Response 423 (Locked) untuk API atau redirect Response untuk halaman jika ditahan.
 * Mengembalikan null jika permintaan diizinkan lewat.
 */
export function enforceOnboardingGate(
  request: Request,
  options?: GateEnforcementOptions,
): Response | null {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Jalur bebas tidak pernah diblokir
  if (isPathExempt(pathname)) {
    return null;
  }

  // Tentukan mode live dari opsi atau process.env
  const isLive =
    options?.isLiveMode ??
    (process.env.DASHBOARD_DATA === "live" ||
      process.env.DATA_MODE === "live" ||
      process.env.DATA_MODE === "nyata");

  const gateState: OnboardingGateState = evaluateOnboardingGate({
    isLiveMode: isLive,
    hasConnectedRouter: options?.hasConnectedRouter ?? false,
    forceLocked: options?.forceLocked ?? false,
  });

  if (!gateState.isLocked) {
    return null;
  }

  // Permintaan API: kembalikan status HTTP 423 Locked
  if (pathname.startsWith("/api/")) {
    return Response.json(
      {
        error: "CONFIGURATION_GATE_LOCKED",
        code: "GATE_LOCKED",
        status: 423,
        message: gateState.reason,
        redirectUrl: "/app/onboarding",
        bannerNotice: gateState.bannerNotice,
        mandatoryDevice: gateState.mandatoryDevice,
        blockedPath: pathname,
      },
      {
        status: 423,
        headers: {
          "Content-Type": "application/json",
          "X-Configuration-Gate": "locked",
        },
      },
    );
  }

  // Permintaan Halaman Web: arahkan ke halaman onboarding / setup
  const redirectUrl = new URL("/setup", request.url);
  return Response.redirect(redirectUrl, 307);
}

/**
 * Wrapper pembungkus handler API untuk penegakan gerbang konfigurasi otomatis.
 */
export function withOnboardingGate(
  request: Request,
  handler: () => Promise<Response>,
  options?: GateEnforcementOptions,
): Promise<Response> {
  const blockedResponse = enforceOnboardingGate(request, options);
  if (blockedResponse) {
    return Promise.resolve(blockedResponse);
  }
  return handler();
}
