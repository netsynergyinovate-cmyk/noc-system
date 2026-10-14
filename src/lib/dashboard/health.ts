import type { CustomerHealth, DashboardCustomer } from "./types";

// Di bawah ambang ini sinyal ONU dianggap lemah (kuning di peta).
export const WEAK_OPTICAL_DBM = -25;

export const healthLabels: Record<CustomerHealth, string> = {
  ok: "Online",
  warning: "Sinyal lemah",
  critical: "Offline",
};

export function getCustomerHealth(
  customer: Pick<DashboardCustomer, "isOnline" | "opticalPowerDbm">,
): CustomerHealth {
  if (!customer.isOnline) return "critical";
  if (customer.opticalPowerDbm < WEAK_OPTICAL_DBM) return "warning";
  return "ok";
}
