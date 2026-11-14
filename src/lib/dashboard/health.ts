import type { CustomerHealth, DashboardCustomer } from "./types";

// Pada/di bawah ambang ini sinyal ONU dianggap lemah (kuning di peta). Sama dengan titik buka alert optik
// Go (batas -25, naik per 1 dBm) dan WeakOpticalDbm di backend/internal/state/types.go.
export const WEAK_OPTICAL_DBM = -26;

export const healthLabels: Record<CustomerHealth, string> = {
  ok: "Online",
  warning: "Sinyal lemah",
  critical: "Offline",
};

export function getCustomerHealth(
  customer: Pick<DashboardCustomer, "isOnline" | "opticalPowerDbm">,
): CustomerHealth {
  if (!customer.isOnline) return "critical";
  if (customer.opticalPowerDbm <= WEAK_OPTICAL_DBM) return "warning";
  return "ok";
}
