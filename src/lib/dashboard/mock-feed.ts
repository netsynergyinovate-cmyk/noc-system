import { billingStatusAtSlot, lastSuccessSlot } from "./billing";
import { TRAFFIC_WINDOW } from "./constants";
import { mockRouters } from "./mock-data";
import type {
  BillingStatusChange,
  DashboardCustomer,
  DashboardDelta,
  DashboardSnapshot,
  StatusChange,
  TrafficPoint,
} from "./types";

// Peluang per pelanggan per detik untuk simulasi putus/tersambung kembali.
const DROP_CHANCE = 0.0008;
const RECOVER_CHANCE = 0.02;

// Bilangan acak berdistribusi normal (Box-Muller), rata-rata 0 dan simpangan 1.
function gaussian() {
  return (
    Math.sqrt(-2 * Math.log(1 - Math.random())) *
    Math.cos(2 * Math.PI * Math.random())
  );
}

// Status tagihan yang berlaku pada `nowSec` (menurut sinkron berhasil terakhir)
// yang berbeda dari yang sedang dipegang: dihitung dari waktu dan keadaan
// sekarang, bukan dari detik sebelumnya, jadi tetap benar walau ada detik yang
// terlewat atau jam bergeser.
function billingChangesAt(
  customers: DashboardCustomer[],
  nowSec: number,
): BillingStatusChange[] {
  const slot = lastSuccessSlot(nowSec);
  const changes: BillingStatusChange[] = [];
  for (const customer of customers) {
    const status = billingStatusAtSlot(customer.id, slot);
    if (status !== null && status !== customer.billingStatus) {
      changes.push({ customerId: customer.id, status });
    }
  }
  return changes;
}

// Pengganti WebSocket backend pada fase frontend: menghasilkan snapshot awal
// dan delta per detik dengan bentuk pesan yang sama.
export function createMockFeed(initialCustomers: DashboardCustomer[]) {
  // Salinan milik feed sendiri; store menerima perubahan lewat delta.
  let customers = initialCustomers;

  // Variasi acak yang mengalir (tiap detik bergantung pada detik sebelumnya),
  // bukan lompatan acak, supaya grafik tampak seperti traffic nyata.
  let rxNoise = 0;
  let txNoise = 0;

  function sample(time: number): TrafficPoint {
    let base = 0;
    for (const customer of customers) {
      if (customer.isOnline) base += customer.planMbps * 0.12;
    }
    base *= 1 + 0.15 * Math.sin(time / 45);
    rxNoise = 0.92 * rxNoise + 0.018 * gaussian();
    txNoise = 0.9 * txNoise + 0.03 * gaussian();
    const rx = base * (1 + rxNoise);
    const tx = base * 0.18 * (1 + txNoise);
    return {
      time,
      rx: Math.round(rx * 10) / 10,
      tx: Math.round(tx * 10) / 10,
    };
  }

  return {
    snapshot(nowSec: number): DashboardSnapshot {
      // Pelanggan dikirim dengan status tagihan yang berlaku sekarang.
      const billing = billingChangesAt(customers, nowSec);
      if (billing.length > 0) {
        const changes = new Map(
          billing.map((change) => [change.customerId, change.status]),
        );
        customers = customers.map((customer) =>
          changes.has(customer.id)
            ? { ...customer, billingStatus: changes.get(customer.id)! }
            : customer,
        );
      }
      const traffic = {
        times: [] as number[],
        rx: [] as number[],
        tx: [] as number[],
      };
      for (let i = TRAFFIC_WINDOW - 1; i >= 0; i -= 1) {
        const point = sample(nowSec - i);
        traffic.times.push(point.time);
        traffic.rx.push(point.rx);
        traffic.tx.push(point.tx);
      }
      return { customers, routers: mockRouters, traffic };
    },

    next(nowSec: number): DashboardDelta {
      const statusChanges: StatusChange[] = [];
      for (const customer of customers) {
        const chance = customer.isOnline ? DROP_CHANCE : RECOVER_CHANCE;
        if (Math.random() < chance) {
          statusChanges.push({
            customerId: customer.id,
            isOnline: !customer.isOnline,
          });
        }
      }
      // Sinkron billing yang baru selesai mengubah status tagihan, hanya pada
      // detik itu; selain itu tidak ada pesan tagihan.
      const billingChanges = billingChangesAt(customers, nowSec);
      if (statusChanges.length > 0 || billingChanges.length > 0) {
        const online = new Map(
          statusChanges.map((change) => [change.customerId, change.isOnline]),
        );
        const billing = new Map(
          billingChanges.map((change) => [change.customerId, change.status]),
        );
        customers = customers.map((customer) => {
          const isOnline = online.get(customer.id);
          const billingStatus = billing.get(customer.id);
          return isOnline === undefined && billingStatus === undefined
            ? customer
            : {
                ...customer,
                ...(isOnline === undefined ? {} : { isOnline }),
                ...(billingStatus === undefined ? {} : { billingStatus }),
              };
        });
      }
      return {
        traffic: sample(nowSec),
        statusChanges,
        ...(billingChanges.length > 0 ? { billingChanges } : {}),
      };
    },
  };
}
