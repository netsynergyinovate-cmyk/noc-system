import { expect, test } from "@playwright/test";
import {
  loadActiveAlerts,
  mockActiveAlerts,
  type ActiveAlert,
} from "../src/lib/dashboard/alerts";
import { correlateAlerts } from "../src/lib/dashboard/correlation";
import {
  buildIncidentCards,
  loadIncidentCards,
  summarizeIncidentCards,
} from "../src/lib/dashboard/incident-cards";
import {
  mockDirectory,
  type ServiceDirectory,
} from "../src/lib/dashboard/incident-root";

// Kartu insiden terkelompok: satu kartu per kelompok korelasi. Bagian pertama
// menguji bentuk kartu dengan direktori palsu; bagian kedua menguji invarian
// pada seluruh data tiruan.

const T0 = 1_791_400_000;
const GRID = Array.from({ length: 2016 }, (_, i) => T0 + i * 300);

const directory: ServiceDirectory = {
  routerName: (id) => `RTR ${id}`,
  customerName: (id) => `Nama ${id}`,
  customersOnRouter: () => 40,
  customersOnOdp: () => 8,
};

let counter = 0;
function alert(
  kind: ActiveAlert["kind"],
  at: number,
  options: {
    odp?: string | null;
    router?: string;
    withPoint?: boolean;
    timeSource?: ActiveAlert["timeSource"];
    uncertainty?: number;
    detectedAfter?: number;
  } = {},
): ActiveAlert {
  const { odp = "ODP-A", router = "router-1", withPoint = true } = options;
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
    detectedAt: T0 + at + (options.detectedAfter ?? 30),
    timeSource: options.timeSource ?? "event",
    timeUncertaintySeconds: options.uncertainty ?? 0,
    location: {
      name: isCustomer ? (odp ?? "alamat") : router,
      address: null,
      odpName: isCustomer ? odp : null,
      latitude: isCustomer && withPoint ? -6.2 : null,
      longitude: isCustomer && withPoint ? 106.8 : null,
    },
  };
}

test.describe("bentuk kartu", () => {
  test("tanpa alert tidak ada kartu", () => {
    expect(buildIncidentCards([], directory)).toEqual([]);
  });

  test("kartu tunggal: akarnya pelanggan itu, tanpa alasan dan keyakinan", () => {
    const lone = alert("offline", 0);
    const [card, ...rest] = buildIncidentCards([lone], directory);
    expect(rest).toEqual([]);
    expect(card.correlationId).toBeNull();
    expect(card.cause).toBe("single");
    expect(card.confidence).toBeNull();
    expect(card.reasons).toEqual([]);
    expect(card.alertCount).toBe(1);
    expect(card.alerts).toEqual([lone]);
    expect(card.rootSource).toEqual({
      kind: "customer",
      id: lone.customerId,
      name: `Nama ${lone.customerId}`,
    });
    expect(card.affectedCustomers).toBe(1);
    expect(card.servedCustomers).toBe(1);
  });

  test("kartu kelompok ODP: id sama dengan correlationId, angka dari akar", () => {
    const members = [
      alert("offline", 0),
      alert("offline", 30),
      alert("optical", 60),
    ];
    const [card] = buildIncidentCards(members, directory);
    expect(card.cause).toBe("odp");
    expect(card.correlationId).toBe(card.id);
    expect(card.alertCount).toBe(3);
    expect(card.rootSource).toEqual({
      kind: "odp",
      id: "ODP-A",
      name: "ODP-A",
    });
    expect(card.affectedCustomers).toBe(3);
    expect(card.servedCustomers).toBe(8);
    expect(card.odpName).toBe("ODP-A");
    expect(card.routerName).toBe("RTR router-1");
    expect(card.confidence).not.toBeNull();
    expect(card.reasons.length).toBeGreaterThan(0);
  });

  test("anggota tertua lebih dulu, dan waktu kartu mengikuti anggota tertua", () => {
    const old = alert("offline", 0, {
      timeSource: "poll",
      uncertainty: 30,
      detectedAfter: 31,
    });
    const mid = alert("offline", 40, { detectedAfter: 12 });
    const recent = alert("offline", 90);
    // Urutan masukan sengaja diacak.
    const [card] = buildIncidentCards([recent, old, mid], directory);
    expect(card.alerts.map((a) => a.id)).toEqual([old.id, mid.id, recent.id]);
    expect(card.startedAt).toBe(old.startedAt);
    expect(card.detectedAt).toBe(old.detectedAt);
    expect(card.timeSource).toBe("poll");
    expect(card.timeUncertaintySeconds).toBe(30);
  });

  test("jumlah per jenis: terbanyak dulu, seri mengikuti urutan jenis tetap", () => {
    const [card] = buildIncidentCards(
      [
        alert("cpu", 0),
        alert("queue", 20),
        alert("queue", 40),
        alert("offline", 60, { odp: "ODP-A" }),
        alert("offline", 80, { odp: "ODP-B" }),
      ],
      directory,
    );
    expect(card.kinds).toEqual([
      { kind: "offline", count: 2 },
      { kind: "queue", count: 2 },
      { kind: "cpu", count: 1 },
    ]);
    expect(card.kinds.reduce((sum, k) => sum + k.count, 0)).toBe(
      card.alertCount,
    );
  });

  test("sorot di peta: pelanggan pertama yang punya titik; kartu router tidak mengarang titik", () => {
    const noPoint = alert("offline", 0, { withPoint: false });
    const withPoint = alert("offline", 20);
    const [customerCard] = buildIncidentCards([noPoint, withPoint], directory);
    expect(customerCard.focusCustomerId).toBe(withPoint.customerId);

    const [routerCard] = buildIncidentCards(
      [alert("queue", 0), alert("port", 100)],
      directory,
    );
    expect(routerCard.focusCustomerId).toBeNull();
    expect(routerCard.affectedCustomers).toBe(0);
    expect(routerCard.rootSource.kind).toBe("router");

    const [pointless] = buildIncidentCards(
      [alert("offline", 0, { withPoint: false })],
      directory,
    );
    expect(pointless.focusCustomerId).toBeNull();
  });

  test("urutan kartu: tingkat terparah, lalu paling banyak anggota, lalu terbaru", () => {
    const cards = buildIncidentCards(
      [
        // Kelompok peringatan berisi tiga alert, di router-2.
        alert("offline", 0, { router: "router-2", odp: "ODP-X" }),
        alert("offline", 20, { router: "router-2", odp: "ODP-X" }),
        alert("offline", 40, { router: "router-2", odp: "ODP-X" }),
        // Kritis tunggal, mulai belakangan: tetap paling atas.
        alert("cpu", 500, { router: "router-3" }),
        // Peringatan tunggal, lebih baru dari kelompok.
        alert("offline", 900, { router: "router-4", odp: "ODP-Y" }),
      ],
      directory,
    );
    expect(cards.map((c) => [c.severity, c.alertCount])).toEqual([
      ["critical", 1],
      ["warning", 3],
      ["warning", 1],
    ]);
  });

  test("hasil tidak bergantung pada urutan masukan dan tidak mengubah masukan", () => {
    const input = [
      alert("cpu", 0),
      alert("offline", 30, { odp: "ODP-A" }),
      alert("offline", 90, { odp: "ODP-B" }),
      alert("offline", 400, { router: "router-9", odp: "ODP-Z" }),
    ];
    const snapshot = JSON.stringify(input);
    const forward = buildIncidentCards(input, directory);
    const backward = buildIncidentCards([...input].reverse(), directory);
    expect(backward).toEqual(forward);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  test("ringkasan menghitung kartu, alert, kartu gabungan, hemat baris, pelanggan, dan kritis", () => {
    const cards = buildIncidentCards(
      [
        alert("cpu", 0),
        alert("offline", 30, { odp: "ODP-A" }),
        alert("offline", 90, { odp: "ODP-B" }),
        alert("offline", 5000, { router: "router-9", odp: "ODP-Z" }),
        alert("optical", 9000, { router: "router-8", odp: "ODP-W" }),
      ],
      directory,
    );
    expect(summarizeIncidentCards(cards)).toEqual({
      cards: 3,
      alerts: 5,
      grouped: 1,
      saved: 2,
      affectedCustomers: 4,
      critical: 1,
    });
    expect(summarizeIncidentCards([])).toEqual({
      cards: 0,
      alerts: 0,
      grouped: 0,
      saved: 0,
      affectedCustomers: 0,
      critical: 0,
    });
  });
});

test.describe("pada data tiruan", () => {
  test("setiap alert aktif ada di tepat satu kartu, dan kartu konsisten", () => {
    const problems: string[] = [];
    let grouped = 0;
    for (const t of GRID) {
      const alerts = mockActiveAlerts(t);
      const cards = buildIncidentCards(alerts);
      const seen = new Map<string, string>();
      const ids = new Set<string>();
      for (const card of cards) {
        if (ids.has(card.id)) problems.push(`${card.id}: id kartu kembar`);
        ids.add(card.id);
        if (card.alerts.length === 0 || card.alertCount !== card.alerts.length)
          problems.push(`${card.id}: jumlah anggota`);
        if (card.kinds.reduce((sum, k) => sum + k.count, 0) !== card.alertCount)
          problems.push(`${card.id}: jumlah per jenis`);
        if (card.servedCustomers < card.affectedCustomers)
          problems.push(`${card.id}: dilayani < terdampak`);
        if (card.alertCount > 1) {
          grouped += 1;
          if (card.correlationId !== card.id)
            problems.push(`${card.id}: correlationId`);
        } else if (card.correlationId !== null) {
          problems.push(`${card.id}: kartu tunggal punya correlationId`);
        }
        const starts = card.alerts.map((a) => a.startedAt);
        if (card.startedAt !== Math.min(...starts))
          problems.push(`${card.id}: waktu mulai bukan anggota tertua`);
        if (
          JSON.stringify(starts) !==
          JSON.stringify([...starts].sort((a, b) => a - b))
        )
          problems.push(`${card.id}: anggota tidak urut`);
        for (const member of card.alerts) {
          if (seen.has(member.id))
            problems.push(`${member.id}: ada di dua kartu`);
          seen.set(member.id, card.id);
          // Kartu dan alert anggotanya harus sepakat soal akar dan dampak.
          if (
            member.rootSource.kind !== card.rootSource.kind ||
            member.rootSource.id !== card.rootSource.id ||
            member.affectedCustomers !== card.affectedCustomers ||
            member.servedCustomers !== card.servedCustomers ||
            member.correlationId !== card.correlationId
          )
            problems.push(`${member.id}: berbeda dari kartunya`);
        }
        if (card.focusCustomerId !== null) {
          const member = card.alerts.find(
            (a) => a.customerId === card.focusCustomerId,
          );
          if (!member || member.location.latitude === null)
            problems.push(`${card.id}: titik sorot tidak valid`);
        }
      }
      if (seen.size !== alerts.length)
        problems.push(
          `t=${t}: ${seen.size} alert di kartu dari ${alerts.length}`,
        );
    }
    expect(grouped).toBeGreaterThan(50);
    expect(problems).toEqual([]);
  });

  test("ringkasan sejalan dengan hasil engine korelasi", () => {
    for (const t of GRID.filter((_, i) => i % 7 === 0)) {
      const alerts = mockActiveAlerts(t);
      const groups = correlateAlerts(alerts, {
        routerName: mockDirectory.routerName,
      });
      const summary = summarizeIncidentCards(buildIncidentCards(alerts));
      expect(summary.cards).toBe(groups.length);
      expect(summary.alerts).toBe(alerts.length);
      expect(summary.grouped).toBe(
        groups.filter((g) => g.alerts.length > 1).length,
      );
    }
  });

  test("loadIncidentCards memuat alert aktif yang sama dan nilainya tetap", async () => {
    const now = T0 + 3000;
    const cards = await loadIncidentCards(now);
    const alerts = await loadActiveAlerts(now);
    expect(cards.reduce((sum, c) => sum + c.alertCount, 0)).toBe(alerts.length);
    expect(await loadIncidentCards(now)).toEqual(cards);
  });
});
