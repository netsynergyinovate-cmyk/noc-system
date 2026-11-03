import "server-only";
import { isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { customers, oltOnus, runsnetCustomers } from "@/db/schema";
import { GenieAcsClient } from "@/lib/genieacs/client";
import { combineCustomerLive, type CustomerLiveStatus, type LiveCpeInput } from "@/lib/dashboard/customer-live";

const CPE_CACHE_MS = 30_000;
let cpeCache: { at: number; data: LiveCpeInput[] | null } | null = null;

// Satu pembacaan penuh daftar modem (cache singkat), dipetakan per username. GenieACS yang tidak terjangkau tidak
// boleh mematikan daftar: redaman jatuh ke data OLT.
async function loadCpe(): Promise<LiveCpeInput[] | null> {
  if (cpeCache && Date.now() - cpeCache.at < CPE_CACHE_MS) return cpeCache.data;
  let data: LiveCpeInput[] | null = null;
  try {
    data = await new GenieAcsClient().listDevices();
  } catch (err) {
    console.warn("Daftar modem GenieACS tidak terbaca untuk daftar pelanggan:", err instanceof Error ? err.message : err);
  }
  cpeCache = { at: Date.now(), data };
  return data;
}

// Hanya membaca. Pemetaan ONU->pelanggan dikerjakan pencocokan otomatis berkala (devices.service) dan menu Petakan.
export async function getCustomerLiveStatus(): Promise<Record<string, CustomerLiveStatus>> {
  const [rows, onus, billing, cpe] = await Promise.all([
    db.select({ id: customers.id, pppoeUsername: customers.pppoeUsername }).from(customers),
    db
      .select({ customerId: oltOnus.customerId, rxPower: oltOnus.rxPower, status: oltOnus.status })
      .from(oltOnus)
      .where(isNotNull(oltOnus.customerId)),
    db.select({ custId: runsnetCustomers.custId, ipAddress: runsnetCustomers.ipAddress }).from(runsnetCustomers),
    loadCpe(),
  ]);
  return combineCustomerLive(
    rows,
    onus.flatMap((o) => (o.customerId ? [{ customerId: o.customerId, rxPower: o.rxPower, status: o.status }] : [])),
    billing,
    cpe,
  );
}
