import type { AlertGroup } from "./correlation.ts";

// SKEMA GANGGUAN: sumber akar dan jumlah terdampak. Tiap gangguan (anomali atau
// alert) membawa empat isian ini, supaya petugas langsung tahu apa yang harus
// diperbaiki (sumber akarnya) dan seberapa besar dampaknya, bukan hanya gejala
// per pelanggan. Isiannya dihitung dari hasil korelasi (correlation.ts).
//
// Kontrak API (diasumsikan frontend; backend menyimpannya di network_logs.detail
// atau kolom baru, dan mengisinya dari rule engine):
//
//   rootSource.kind   apa yang diduga menjadi akar: customer, odp, router, uplink.
//   rootSource.id     id pelanggan, nama ODP, atau id router (untuk uplink: id
//                     router yang uplink-nya diduga bermasalah).
//   rootSource.name   nama untuk ditampilkan: nama pelanggan, nama ODP, nama router.
//   affectedCustomers pelanggan yang TERBUKTI terdampak, yaitu yang punya alert
//                     sendiri. Nol bila belum ada (mis. CPU router tinggi tanpa
//                     pelanggan yang putus).
//   servedCustomers   seluruh pelanggan yang dilayani sumber akar itu: batas atas
//                     dampak. Selalu >= affectedCustomers.
//   correlationId     id kelompok korelasi bila gangguan ini bagian dari kelompok
//                     (sedikitnya dua alert dengan penyebab sama), selain itu null.

export type RootSourceKind = "customer" | "odp" | "router" | "uplink";

export interface RootSource {
  kind: RootSourceKind;
  id: string;
  name: string;
}

export interface IncidentImpact {
  rootSource: RootSource;
  affectedCustomers: number;
  servedCustomers: number;
  correlationId: string | null;
}

// Sumber data yang dibutuhkan untuk menamai dan menghitung. Pada backend
// sungguhan ini adalah query ke tabel routers dan customers.
export interface ServiceDirectory {
  routerName(routerId: string): string;
  customerName(customerId: string): string;
  customersOnRouter(routerId: string): number;
  customersOnOdp(routerId: string, odpName: string): number;
}

// Gangguan yang berdiri sendiri: pelanggan sendiri sebagai akarnya, atau routernya
// untuk gangguan router (yang belum terbukti mengenai pelanggan mana pun).
export function loneImpact(
  alert: { routerId: string; customerId: string | null },
  directory: ServiceDirectory,
): IncidentImpact {
  if (alert.customerId !== null) {
    return {
      rootSource: {
        kind: "customer",
        id: alert.customerId,
        name: directory.customerName(alert.customerId),
      },
      affectedCustomers: 1,
      servedCustomers: 1,
      correlationId: null,
    };
  }
  return {
    rootSource: {
      kind: "router",
      id: alert.routerId,
      name: directory.routerName(alert.routerId),
    },
    affectedCustomers: 0,
    servedCustomers: directory.customersOnRouter(alert.routerId),
    correlationId: null,
  };
}

// Anggota kelompok korelasi: akarnya adalah penyebab bersama kelompok itu.
export function groupImpact(
  group: AlertGroup,
  directory: ServiceDirectory,
): IncidentImpact {
  if (group.alerts.length === 1) return loneImpact(group.alerts[0], directory);
  const routerName = directory.routerName(group.routerId);
  const served = (): number => {
    if (group.cause === "odp" && group.odpName !== null) {
      return directory.customersOnOdp(group.routerId, group.odpName);
    }
    return directory.customersOnRouter(group.routerId);
  };
  const rootSource: RootSource =
    group.cause === "odp" && group.odpName !== null
      ? { kind: "odp", id: group.odpName, name: group.odpName }
      : group.cause === "uplink"
        ? { kind: "uplink", id: group.routerId, name: `Uplink ${routerName}` }
        : { kind: "router", id: group.routerId, name: routerName };
  return {
    rootSource,
    affectedCustomers: group.customerCount,
    // Batas atas tidak boleh lebih kecil dari yang sudah terbukti terdampak.
    servedCustomers: Math.max(served(), group.customerCount),
    correlationId: group.id,
  };
}

// Direktori dari data tiruan.
const mockCustomers: {
  id: string;
  name: string;
  routerId?: string;
  odpName?: string;
}[] = [];
const customerById = new Map<
  string,
  { id: string; name: string; routerId?: string; odpName?: string }
>();
const routerById = new Map<string, { id: string; name: string }>();

export const mockDirectory: ServiceDirectory = {
  routerName: (routerId) => routerById.get(routerId)?.name ?? routerId,
  customerName: (customerId) =>
    customerById.get(customerId)?.name ?? customerId,
  customersOnRouter: (routerId) =>
    mockCustomers.filter((customer) => customer.routerId === routerId).length,
  customersOnOdp: (routerId, odpName) =>
    mockCustomers.filter(
      (customer) =>
        customer.routerId === routerId && customer.odpName === odpName,
    ).length,
};
