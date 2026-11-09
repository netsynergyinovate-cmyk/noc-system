import { getCustomerHealth } from "./health";
import type { DashboardCustomer } from "./types";

export type StatusFilter = "all" | "online" | "offline" | "weak" | "los";

export interface CustomerFilters {
  query: string;
  status: StatusFilter;
  // "all" atau id router.
  routerId: string;
}

export const defaultFilters: CustomerFilters = {
  query: "",
  status: "all",
  routerId: "all",
};

export function hasActiveFilters(filters: CustomerFilters) {
  return (
    filters.query.trim() !== "" ||
    filters.status !== "all" ||
    filters.routerId !== "all"
  );
}

export function filterCustomers(
  customers: DashboardCustomer[],
  filters: CustomerFilters,
) {
  const query = filters.query.trim().toLowerCase();
  return customers.filter((customer) => {
    if (filters.routerId !== "all" && customer.routerId !== filters.routerId) {
      return false;
    }
    if (filters.status === "online" && !customer.isOnline) return false;
    if (filters.status === "offline" && customer.isOnline) return false;
    if (filters.status === "los" && !customer.isLos) {
      return false;
    }
    if (
      filters.status === "weak" &&
      getCustomerHealth(customer) !== "warning"
    ) {
      return false;
    }
    if (!query) return true;
    return (
      customer.name.toLowerCase().includes(query) ||
      customer.pppoeUsername.toLowerCase().includes(query) ||
      customer.address.toLowerCase().includes(query)
    );
  });
}
