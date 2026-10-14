import { expect, test } from "@playwright/test";
import {
  mockActiveAlerts,
  type ActiveAlert,
} from "../src/lib/dashboard/alerts";
import { loadAnomalies } from "../src/lib/dashboard/anomaly-feed";
import { correlateAlerts } from "../src/lib/dashboard/correlation";
import {
  groupImpact,
  loneImpact,
  mockDirectory,
  type ServiceDirectory,
} from "../src/lib/dashboard/incident-root";
import {
  createMockCustomers,
  mockRouters,
} from "../src/lib/dashboard/mock-data";

// Skema gangguan: sumber akar dan jumlah terdampak. Bagian pertama menguji
// aturan hitungnya dengan direktori palsu; bagian kedua menguji invarian pada
// seluruh data tiruan, yang sudah dilengkapi lewat korelasi.

const T0 = 1_791_400_000;
const GRID = Array.from({ length: 2016 }, (_, i) => T0 + i * 300);

// Direktori kecil dan mudah dihitung dengan tangan.
const directory: ServiceDirectory = {
  routerName: (id) => `RTR ${id}`,
  customerName: (id) => `Nama ${id}`,
  customersOnRouter: () => 40,
  customersOnOdp: (_router, odp) => (odp === "ODP-A" ? 8 : 5),
};

let counter = 0;
function alert(
  kind: ActiveAlert["kind"],
  at: number,
  odp: string | null = "ODP-A",
  router = "router-1",
): ActiveAlert {
  counter += 1;
  const isCustomer = kind === "offline" || kind === "optical";
  const customerId = isCustomer ? `c${counter}` : null;
  return {
    id: `a${counter}`,
    kind,
    severity:
      kind === "offline" || kind === "optical" || kind === "port"
        ? "warning"
        : "critical",
    startedAt: T0 + at,
    endedAt: null,
    routerId: router,
    customerId,
    interfaceName: null,
    measured: null,
    rootSource: { kind: "router", id: router, name: router },
    affectedCustomers: 0,
    servedCustomers: 0,
    correlationId: null,
    detectedAt: T0 + at + 30,
    timeSource: "event",
    timeUncertaintySeconds: 0,
    location: {
      name: isCustomer ? (odp ?? "alamat") : router,
      address: null,
      odpName: isCustomer ? odp : null,
      latitude: null,
      longitude: null,
    },
  };
}

test.describe("aturan sumber akar dan dampak", () => {
  test("pelanggan yang berdiri sendiri adalah akarnya sendiri", () => {
    const lone = alert("offline", 0);
    expect(loneImpact(lone, directory)).toEqual({
      rootSource: {
        kind: "customer",
        id: lone.customerId,
        name: `Nama ${lone.customerId}`,
      },
      affectedCustomers: 1,
      servedCustomers: 1,
      correlationId: null,
    });
  });

  test("gangguan router yang berdiri sendiri: akarnya router, belum ada pelanggan terbukti terdampak", () => {
    expect(loneImpact(alert("cpu", 0), directory)).toEqual({
      rootSource: { kind: "router", id: "router-1", name: "RTR router-1" },
      affectedCustomers: 0,
      servedCustomers: 40,
      correlationId: null,
    });
  });

  test("beberapa pelanggan di satu ODP: akarnya ODP, terdampak yang beralert dari yang dilayaninya", () => {
    const [group] = correlateAlerts([
      alert("offline", 0),
      alert("offline", 30),
      alert("optical", 60),
    ]);
    expect(group.cause).toBe("odp");
    expect(groupImpact(group, directory)).toEqual({
      rootSource: { kind: "odp", id: "ODP-A", name: "ODP-A" },
      affectedCustomers: 3,
      servedCustomers: 8,
      correlationId: group.id,
    });
  });

  test("router bermasalah dan pelanggannya ikut: akarnya router", () => {
    const [group] = correlateAlerts([
      alert("cpu", 0),
      alert("offline", 30, "ODP-A"),
      alert("offline", 90, "ODP-B"),
    ]);
    expect(group.cause).toBe("router");
    expect(groupImpact(group, directory)).toEqual({
      rootSource: { kind: "router", id: "router-1", name: "RTR router-1" },
      affectedCustomers: 2,
      servedCustomers: 40,
      correlationId: group.id,
    });
  });

  test("lonjakan offline di ODP berbeda: akarnya uplink router itu", () => {
    const [group] = correlateAlerts([
      alert("offline", 0, "ODP-A"),
      alert("offline", 60, "ODP-B"),
      alert("offline", 120, "ODP-C"),
    ]);
    expect(group.cause).toBe("uplink");
    expect(groupImpact(group, directory)).toEqual({
      rootSource: {
        kind: "uplink",
        id: "router-1",
        name: "Uplink RTR router-1",
      },
      affectedCustomers: 3,
      servedCustomers: 40,
      correlationId: group.id,
    });
  });

  test("kelompok yang hanya berisi gangguan router tidak mengarang pelanggan terdampak", () => {
    const [group] = correlateAlerts([alert("queue", 0), alert("port", 100)]);
    const impact = groupImpact(group, directory);
    expect(impact.affectedCustomers).toBe(0);
    expect(impact.servedCustomers).toBe(40);
    expect(impact.rootSource.kind).toBe("router");
    expect(impact.correlationId).toBe(group.id);
  });

  test("yang dilayani tidak pernah lebih kecil dari yang terdampak", () => {
    const tiny: ServiceDirectory = {
      ...directory,
      customersOnOdp: () => 1,
      customersOnRouter: () => 1,
    };
    const [group] = correlateAlerts([
      alert("offline", 0),
      alert("offline", 10),
      alert("offline", 20),
    ]);
    const impact = groupImpact(group, tiny);
    expect(impact.affectedCustomers).toBe(3);
    expect(impact.servedCustomers).toBe(3);
  });

  test("kelompok berisi satu alert sama dengan alert yang berdiri sendiri", () => {
    const lone = alert("offline", 0);
    const [group] = correlateAlerts([lone]);
    expect(groupImpact(group, directory)).toEqual(loneImpact(lone, directory));
  });
});

test.describe("pada data tiruan", () => {
  const customers = new Map(createMockCustomers().map((c) => [c.id, c]));
  const routers = new Set(mockRouters.map((r) => r.id));

  test("setiap alert aktif membawa sumber akar dan dampak yang masuk akal", () => {
    const problems: string[] = [];
    let router = 0;
    let odp = 0;
    let grouped = 0;
    for (const t of GRID) {
      const alerts = mockActiveAlerts(t);
      const byCorrelation = new Map<string, ActiveAlert[]>();
      for (const a of alerts) {
        const { rootSource: root } = a;
        if (!root.id || !root.name) problems.push(`${a.id}: akar kosong`);
        if (a.affectedCustomers < 0 || a.affectedCustomers > a.servedCustomers)
          problems.push(
            `${a.id}: terdampak ${a.affectedCustomers} > dilayani ${a.servedCustomers}`,
          );
        if (a.servedCustomers < 1)
          problems.push(`${a.id}: tidak ada yang dilayani`);
        if (a.correlationId === null) {
          // Berdiri sendiri: pelanggan itu sendiri, atau routernya.
          if (a.customerId !== null) {
            if (root.kind !== "customer" || root.id !== a.customerId)
              problems.push(`${a.id}: akar pelanggan salah`);
            if (a.affectedCustomers !== 1 || a.servedCustomers !== 1)
              problems.push(`${a.id}: dampak pelanggan salah`);
            if (root.name !== customers.get(a.customerId)?.name)
              problems.push(`${a.id}: nama pelanggan`);
          } else {
            if (
              root.kind !== "router" ||
              root.id !== a.routerId ||
              a.affectedCustomers !== 0
            )
              problems.push(`${a.id}: akar router salah`);
          }
        } else {
          grouped += 1;
          byCorrelation.set(a.correlationId, [
            ...(byCorrelation.get(a.correlationId) ?? []),
            a,
          ]);
          if (root.kind === "odp") odp += 1;
          if (root.kind === "router") router += 1;
        }
        if (!routers.has(a.routerId))
          problems.push(`${a.id}: router tidak dikenal`);
      }
      // Satu kelompok: akar dan angkanya sama untuk semua anggota, sedikitnya dua.
      for (const [id, members] of byCorrelation) {
        if (members.length < 2)
          problems.push(`${id}: kelompok beranggota satu`);
        const first = members[0];
        for (const member of members) {
          if (
            JSON.stringify([
              member.rootSource,
              member.affectedCustomers,
              member.servedCustomers,
            ]) !==
            JSON.stringify([
              first.rootSource,
              first.affectedCustomers,
              first.servedCustomers,
            ])
          )
            problems.push(`${id}: anggota tidak sepakat`);
        }
      }
    }
    // Korelasi benar-benar terjadi pada data tiruan, untuk kedua jenis akar utama.
    expect(grouped).toBeGreaterThan(50);
    expect(router).toBeGreaterThan(0);
    expect(odp).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test("kelompok pada data cocok dengan hasil engine korelasi dari alert yang sama", () => {
    const problems: string[] = [];
    for (const t of GRID.filter((_, i) => i % 5 === 0)) {
      const alerts = mockActiveAlerts(t);
      const groups = correlateAlerts(alerts, {
        routerName: mockDirectory.routerName,
      });
      for (const group of groups) {
        const impact = groupImpact(group, mockDirectory);
        for (const member of group.alerts) {
          const shown = alerts.find((a) => a.id === member.id)!;
          if (shown.correlationId !== impact.correlationId)
            problems.push(`${member.id}: id kelompok`);
          if (shown.rootSource.kind !== impact.rootSource.kind)
            problems.push(`${member.id}: jenis akar`);
          if (shown.affectedCustomers !== impact.affectedCustomers)
            problems.push(`${member.id}: terdampak`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test("riwayat anomali yang sudah selesai berdiri sendiri dengan akar yang benar", async () => {
    const list = await loadAnomalies(T0);
    const history = list.filter((a) => a.endedAt !== null);
    expect(history.length).toBeGreaterThan(10);
    for (const item of history) {
      expect(item.correlationId, item.id).toBeNull();
      expect(item.rootSource.kind, item.id).toBe(
        item.customerId ? "customer" : "router",
      );
      expect(item.affectedCustomers, item.id).toBe(item.customerId ? 1 : 0);
    }
  });

  test("nilai sama setiap dihitung", () => {
    expect(mockActiveAlerts(T0 + 3000)).toEqual(mockActiveAlerts(T0 + 3000));
  });
});
