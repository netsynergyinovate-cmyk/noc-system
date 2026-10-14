"use client";

import { useMemo } from "react";
import { useDashboardStore } from "@/lib/dashboard/store";

// Peta id -> nama dari store, dibuat sekali per daftar (bukan per baris).
export function useSubjectLookup() {
  const routers = useDashboardStore((state) => state.routers);
  const customers = useDashboardStore((state) => state.customers);
  return useMemo(
    () => ({
      routerNames: new Map(routers.map((router) => [router.id, router.name])),
      customerById: new Map(
        customers.map((customer) => [customer.id, customer]),
      ),
    }),
    [routers, customers],
  );
}

export type SubjectLookup = ReturnType<typeof useSubjectLookup>;

const UNKNOWN_CUSTOMER = "Pelanggan tidak dikenal";

// Nama yang terkena dalam satu teks: pelanggan, atau routernya untuk alert router.
// Untuk label tombol dan kalimat; tampilan di tabel memakai AnomalySubject.
export function subjectLabel(
  anomaly: { customerId: string | null; routerId: string },
  lookup: SubjectLookup,
) {
  if (!anomaly.customerId) {
    return lookup.routerNames.get(anomaly.routerId) ?? "Router";
  }
  return lookup.customerById.get(anomaly.customerId)?.name ?? UNKNOWN_CUSTOMER;
}

// Siapa atau apa yang terkena: pelanggan (dengan routernya) atau router saja.
export function AnomalySubject({
  anomaly,
  lookup,
}: {
  anomaly: { customerId: string | null; routerId: string };
  lookup: SubjectLookup;
}) {
  const routerName = lookup.routerNames.get(anomaly.routerId);
  if (!anomaly.customerId) {
    return <div className="font-medium">{routerName ?? "Router"}</div>;
  }
  const customer = lookup.customerById.get(anomaly.customerId);
  return (
    <>
      <div className="font-medium">{customer?.name ?? UNKNOWN_CUSTOMER}</div>
      <div className="font-mono text-xs text-muted-foreground">
        {customer?.pppoeUsername ?? anomaly.customerId}
      </div>
      <div className="text-xs text-muted-foreground">{routerName ?? ""}</div>
    </>
  );
}
