// Memilih mode operasi perangkat: simulator atau asli. Murni (tanpa window,
// localStorage, atau server-only). Hanya NAMA variabel env yang pernah
// keluar di hasil, tidak pernah nilainya.
import {
  DEVICE_KINDS,
  evaluateDeviceEnv,
  type DeviceKind,
} from "./device-env-loader.ts";

export type DeviceOperationMode = "simulator" | "real";
export type DashboardDataMode = "demo" | "live";
export type DeviceModeReason =
  "REQUESTED_SIMULATOR" | "REAL_READY" | "ENV_INCOMPLETE" | "DEMO_DEFAULT";

export type ResolveDeviceModeOptions = {
  kind: DeviceKind;
  requestedMode?: DeviceOperationMode;
  dashboardData?: DashboardDataMode;
  envSource?: Readonly<Record<string, string | undefined>>;
  /** Default true: env asli belum lengkap jatuh ke simulator. false: fail-fast. */
  allowFallback?: boolean;
};

export type DeviceModeResolution = {
  kind: DeviceKind;
  effectiveMode: DeviceOperationMode;
  fallback: boolean;
  /** Env wajib untuk mode asli lengkap. */
  ready: boolean;
  reason: DeviceModeReason;
  /** Nama variabel env yang belum diisi (bukan nilai). */
  missingEnv: string[];
  warning: string | null;
};

export function resolveDeviceOperationMode(
  options: ResolveDeviceModeOptions,
): DeviceModeResolution {
  const { kind, requestedMode, dashboardData, envSource, allowFallback } =
    options;
  const env = evaluateDeviceEnv(kind, envSource);
  const ready = env.status === "siap";
  const base = { kind, ready, missingEnv: env.missing };

  if (requestedMode === "simulator") {
    return {
      ...base,
      effectiveMode: "simulator",
      fallback: false,
      reason: "REQUESTED_SIMULATOR",
      warning: null,
    };
  }

  const wantsReal =
    requestedMode === "real" || (!requestedMode && dashboardData === "live");
  if (!wantsReal) {
    return {
      ...base,
      effectiveMode: "simulator",
      fallback: false,
      reason: "DEMO_DEFAULT",
      warning: null,
    };
  }

  if (ready) {
    return {
      ...base,
      effectiveMode: "real",
      fallback: false,
      reason: "REAL_READY",
      warning: null,
    };
  }

  const names = env.missing.join(", ");
  if (allowFallback !== false) {
    return {
      ...base,
      effectiveMode: "simulator",
      fallback: true,
      reason: "ENV_INCOMPLETE",
      warning: `Mode asli ${kind} diminta tetapi kredensial belum lengkap (${names}). Memakai simulator.`,
    };
  }
  return {
    ...base,
    effectiveMode: "real",
    fallback: false,
    reason: "ENV_INCOMPLETE",
    warning: `Mode asli ${kind} dipilih tanpa fallback, tetapi kredensial belum ada (${names}).`,
  };
}

export function resolveAllDeviceModes(
  options: Omit<ResolveDeviceModeOptions, "kind"> = {},
): Record<DeviceKind, DeviceModeResolution> {
  return Object.fromEntries(
    DEVICE_KINDS.map((kind) => [
      kind,
      resolveDeviceOperationMode({ ...options, kind }),
    ]),
  ) as Record<DeviceKind, DeviceModeResolution>;
}
