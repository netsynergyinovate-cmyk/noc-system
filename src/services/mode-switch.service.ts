import "server-only";

import {
  getModeSummary,
  resolveDeviceMode,
  type DeviceTarget,
  type ModeSummary,
  type RuntimeMode,
} from "@/lib/mode-switch";

const TARGETS: readonly DeviceTarget[] = ["mikrotik", "olt", "genieacs", "billing"];

export function getDeviceMode(device: DeviceTarget): RuntimeMode {
  return resolveDeviceMode(device, process.env);
}

export function getAllModes(): Record<DeviceTarget, RuntimeMode> {
  return Object.fromEntries(TARGETS.map((d) => [d, getDeviceMode(d)])) as Record<
    DeviceTarget,
    RuntimeMode
  >;
}

export function getSystemModeSummary(): ModeSummary {
  return getModeSummary(process.env);
}

export function validateProductionCompliance(): { compliant: boolean; violations: string[] } {
  const s = getSystemModeSummary();
  return { compliant: s.isGoLiveCompliant, violations: s.violations };
}
