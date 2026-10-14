// Saklar mode simulator/perangkat asli (logika murni, tanpa server-only agar bisa diuji).

export type RuntimeMode = "simulator" | "real";
export type DeviceTarget = "mikrotik" | "olt" | "genieacs" | "billing";

export interface ModeSummary {
  globalMode: RuntimeMode;
  dataMode: "demo" | "live";
  isProduction: boolean;
  devices: Record<DeviceTarget, RuntimeMode>;
  hasSimulatorActive: boolean;
  isGoLiveCompliant: boolean;
  violations: string[];
}

type Source = Record<string, string | undefined>;

export class ModeViolationError extends Error {
  readonly code = "SIMULATOR_NOT_ALLOWED" as const;
  constructor(
    message: string,
    public device?: DeviceTarget,
  ) {
    super(message);
    this.name = "ModeViolationError";
  }
}

const DEVICES: readonly DeviceTarget[] = ["mikrotik", "olt", "genieacs", "billing"];
const DEVICE_ENV: Record<DeviceTarget, string> = {
  mikrotik: "MIKROTIK_MODE",
  olt: "OLT_MODE",
  genieacs: "GENIEACS_MODE",
  billing: "BILLING_MODE",
};

export function normalizeMode(
  raw: string | undefined,
  fallback: RuntimeMode = "simulator",
): RuntimeMode {
  const v = raw?.trim().toLowerCase();
  if (v === "real" || v === "live" || v === "nyata") return "real";
  if (v === "simulator" || v === "demo" || v === "dummy") return "simulator";
  return fallback;
}

// ponytail: nilai env tak dikenal jatuh ke tingkat prioritas berikutnya, bukan error.
export function resolveDeviceMode(device: DeviceTarget, source: Source = {}): RuntimeMode {
  // normalizeMode dengan dua fallback berbeda: tak dikenal = kedua hasil berbeda.
  const known = (raw: string | undefined) => {
    const a = normalizeMode(raw, "simulator");
    return a === normalizeMode(raw, "real") ? a : undefined;
  };
  return (
    known(source[DEVICE_ENV[device]]) ??
    known(source.DEVICE_MODE) ??
    known(source.DASHBOARD_DATA) ??
    known(source.DATA_MODE) ??
    "simulator"
  );
}

export function isProductionEnvironment(source: Source = {}): boolean {
  return (
    source.NODE_ENV === "production" ||
    source.DASHBOARD_DATA === "live" ||
    source.DATA_MODE === "nyata"
  );
}

function violationMessage(device: DeviceTarget) {
  return `Pelanggaran Go-Live: Perangkat ${device} berjalan dalam mode simulator di lingkungan produksi/live.`;
}

export function assertNoSimulatorInProduction(device: DeviceTarget, source: Source = {}): void {
  if (isProductionEnvironment(source) && resolveDeviceMode(device, source) === "simulator") {
    throw new ModeViolationError(violationMessage(device), device);
  }
}

export function getModeSummary(source: Source = {}): ModeSummary {
  const devices = Object.fromEntries(
    DEVICES.map((d) => [d, resolveDeviceMode(d, source)]),
  ) as Record<DeviceTarget, RuntimeMode>;
  const isProduction = isProductionEnvironment(source);
  const hasSimulatorActive = DEVICES.some((d) => devices[d] === "simulator");
  const violations = isProduction
    ? DEVICES.filter((d) => devices[d] === "simulator").map(violationMessage)
    : [];
  const globalMode = normalizeMode(source.DEVICE_MODE, normalizeMode(source.DASHBOARD_DATA));
  return {
    globalMode,
    dataMode: source.DASHBOARD_DATA === "live" || source.DATA_MODE === "nyata" ? "live" : "demo",
    isProduction,
    devices,
    hasSimulatorActive,
    isGoLiveCompliant: violations.length === 0,
    violations,
  };
}
