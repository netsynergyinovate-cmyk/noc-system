import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { useDashboardStore } from "../src/lib/dashboard/store";
import type {
  BillingStatusChange,
  DashboardCustomer,
  DashboardDelta,
  DashboardSnapshot,
} from "../src/lib/dashboard/types";

// KONTRAK LINTAS BAHASA untuk perubahan status tagihan lewat WebSocket hub.
//
// Tes Go backend/internal/hub (TestGoldenSnapshotAndDeltaWithBillingChanges)
// menjalankan hub sungguhan dengan klien WebSocket, menangkap pesan `snapshot`
// (sebelum sinkron) dan `delta` (yang membawa hasil sinkron: `billingChanges`) lalu
// membandingkannya BYTE PER BYTE dengan dua berkas di backend/internal/hub/testdata.
// Berkas itu hanya ditulis ulang dengan UPDATE_GOLDEN=1 bila kontraknya sengaja
// berubah. Spesifikasi ini menutup lingkarannya dari sisi frontend: pesan yang
// sama diterapkan lewat store Zustand ASLI (applySnapshot dan applyDelta).
//
// Catatan: snapshot Go belum membawa planMbps dan memakai null untuk koordinat dan
// daya optik yang belum ada; tes ini hanya menegaskan bagian tagihan dan online.

type GoldenSnapshot = DashboardSnapshot & { type: "snapshot"; time: number };
type GoldenDelta = DashboardDelta & { type: "delta"; time: number };

const read = (name: string) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../backend/internal/hub/testdata/${name}`, import.meta.url),
      ),
      "utf8",
    ),
  ) as unknown;

const snapshot = read("snapshot_billing.golden.json") as GoldenSnapshot;
const delta = read("delta_billing.golden.json") as GoldenDelta;
const NOW = delta.time;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function loadSnapshot() {
  useDashboardStore
    .getState()
    .applySnapshot(clone(snapshot) as DashboardSnapshot, snapshot.time);
  return useDashboardStore.getState().customers;
}

const byId = (customers: DashboardCustomer[]) =>
  new Map(customers.map((customer) => [customer.id, customer]));

test.describe("kontrak pesan hub: status tagihan", () => {
  test("bentuk pesan golden sesuai tipe frontend", () => {
    expect(snapshot.type).toBe("snapshot");
    expect(delta.type).toBe("delta");
    expect(snapshot.customers.length).toBeGreaterThanOrEqual(3);
    for (const customer of snapshot.customers) {
      expect(["lunas", "isolir"], customer.id).toContain(
        customer.billingStatus,
      );
    }
    expect(Array.isArray(delta.billingChanges)).toBe(true);
    for (const change of delta.billingChanges as BillingStatusChange[]) {
      expect(Object.keys(change).sort()).toEqual(["customerId", "status"]);
      expect(["lunas", "isolir"]).toContain(change.status);
    }
    // Isi golden yang membuat tes di bawah bermakna: ada yang berubah, ada yang
    // tetap, dan satu pelanggan juga berubah status online pada detik yang sama.
    const statuses = new Map(
      snapshot.customers.map((c) => [c.id, c.billingStatus]),
    );
    const changed = (delta.billingChanges ?? []).map((c) => c.customerId);
    expect(changed.length).toBeGreaterThanOrEqual(2);
    for (const change of delta.billingChanges ?? []) {
      expect(statuses.get(change.customerId), change.customerId).not.toBe(
        change.status,
      );
    }
    expect(statuses.size).toBeGreaterThan(changed.length);
    expect(delta.statusChanges.length).toBeGreaterThanOrEqual(1);
  });

  test("snapshot memuat status tagihan tiap pelanggan ke store", () => {
    const customers = loadSnapshot();
    expect(customers).toHaveLength(snapshot.customers.length);
    for (const golden of snapshot.customers) {
      expect(byId(customers).get(golden.id)?.billingStatus, golden.id).toBe(
        golden.billingStatus,
      );
    }
  });

  test("delta mengganti status pelanggan yang berubah saja; yang lain tetap objek yang sama", () => {
    const before = loadSnapshot();
    const beforeById = byId(before);
    useDashboardStore
      .getState()
      .applyDelta(clone(delta) as DashboardDelta, NOW);
    const after = useDashboardStore.getState().customers;
    expect(after).not.toBe(before);

    const billing = new Map(
      (delta.billingChanges ?? []).map((c) => [c.customerId, c.status]),
    );
    const online = new Map(
      delta.statusChanges.map((c) => [c.customerId, c.isOnline]),
    );
    let untouched = 0;
    for (const customer of after) {
      const old = beforeById.get(customer.id)!;
      if (billing.has(customer.id) || online.has(customer.id)) {
        expect(customer).not.toBe(old);
        expect(customer).toEqual({
          ...old,
          ...(billing.has(customer.id)
            ? { billingStatus: billing.get(customer.id) }
            : {}),
          ...(online.has(customer.id)
            ? { isOnline: online.get(customer.id) }
            : {}),
        });
      } else {
        expect(customer, customer.id).toBe(old);
        untouched += 1;
      }
    }
    expect(untouched).toBeGreaterThanOrEqual(1);
    for (const [id, status] of billing) {
      expect(byId(after).get(id)?.billingStatus, id).toBe(status);
    }
    // Pelanggan yang hanya berubah online tidak ikut berganti status tagihannya.
    for (const [id] of online) {
      if (!billing.has(id)) {
        expect(byId(after).get(id)?.billingStatus).toBe(
          beforeById.get(id)?.billingStatus,
        );
      }
    }
  });

  test("pelanggan yang tidak ada di billingChanges maupun statusChanges tidak tersentuh", () => {
    const before = loadSnapshot();
    useDashboardStore
      .getState()
      .applyDelta(clone(delta) as DashboardDelta, NOW);
    const touched = new Set([
      ...(delta.billingChanges ?? []).map((c) => c.customerId),
      ...delta.statusChanges.map((c) => c.customerId),
    ]);
    const untouched = before.filter((c) => !touched.has(c.id));
    expect(untouched.length).toBeGreaterThanOrEqual(1);
    const after = byId(useDashboardStore.getState().customers);
    for (const customer of untouched) {
      expect(after.get(customer.id), customer.id).toBe(customer);
    }
  });

  test("pesan yang sama dua kali tidak mengubah apa pun lagi", () => {
    loadSnapshot();
    useDashboardStore
      .getState()
      .applyDelta(clone(delta) as DashboardDelta, NOW);
    const once = useDashboardStore.getState().customers;
    useDashboardStore
      .getState()
      .applyDelta(clone(delta) as DashboardDelta, NOW + 1);
    expect(useDashboardStore.getState().customers).toBe(once);
  });

  test("delta tanpa billingChanges tidak mengubah status tagihan siapa pun", () => {
    const before = loadSnapshot();
    const { billingChanges, ...plain } = clone(delta);
    expect(billingChanges).toBeDefined();
    expect("billingChanges" in plain).toBe(false);
    useDashboardStore
      .getState()
      .applyDelta({ ...plain, statusChanges: [] } as DashboardDelta, NOW);
    expect(useDashboardStore.getState().customers).toBe(before);

    // Dengan statusChanges tetap ada pun, tidak ada status tagihan yang bergeser.
    useDashboardStore.getState().applyDelta(plain as DashboardDelta, NOW + 1);
    const beforeById = byId(before);
    for (const customer of useDashboardStore.getState().customers) {
      expect(customer.billingStatus, customer.id).toBe(
        beforeById.get(customer.id)?.billingStatus,
      );
    }
  });
});
