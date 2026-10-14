import { expect, test } from "@playwright/test";
import { anomalyRules } from "../src/lib/dashboard/anomalies";
import {
  createMockCustomers,
  mockRouters,
} from "../src/lib/dashboard/mock-data";
import {
  POLL_SECONDS,
  describeLocation,
  describeTimeSource,
  formatAlertTime,
  loadActiveAlerts,
  locationFor,
  mockActiveAlerts,
  sortActiveAlerts,
  type ActiveAlert,
  type AlertLocation,
} from "../src/lib/dashboard/alerts";

// Kontrak API alert aktif: waktu mulai tepat sampai detik, dengan penanda dari
// mana waktu itu berasal. Tanpa browser; yang diuji adalah data dan tampilannya.

const NOW = 1_791_400_000;
const STEP = 300;
const samples = Array.from(
  { length: (7 * 24 * 3600) / STEP },
  (_, index) => NOW + index * STEP,
);

const everyAlert = samples.flatMap((now) =>
  mockActiveAlerts(now).map((alert) => ({ now, alert })),
);

test.describe("data alert aktif tiruan", () => {
  test("sama setiap dihitung untuk waktu yang sama, dan lewat loader yang sama", async () => {
    expect(mockActiveAlerts(NOW)).toEqual(mockActiveAlerts(NOW));
    expect(await loadActiveAlerts(NOW)).toEqual(mockActiveAlerts(NOW));
  });

  test("waktu selalu bilangan bulat detik, dan alert baru ada setelah lama yang disyaratkan aturan", () => {
    const forSeconds = Object.fromEntries(
      anomalyRules.map((rule) => [rule.kind, rule.forSeconds]),
    );
    const problems: string[] = [];
    for (const { now, alert } of everyAlert) {
      if (!Number.isInteger(alert.startedAt))
        problems.push(`${alert.id}: startedAt bukan bulat`);
      if (!Number.isInteger(alert.detectedAt))
        problems.push(`${alert.id}: detectedAt bukan bulat`);
      if (alert.endedAt !== null) problems.push(`${alert.id}: endedAt terisi`);
      if (alert.detectedAt !== alert.startedAt + forSeconds[alert.kind])
        problems.push(`${alert.id}: detectedAt salah`);
      if (alert.detectedAt > now)
        problems.push(`${alert.id}: belum terdeteksi tetapi sudah tampil`);
    }
    expect(everyAlert.length).toBeGreaterThan(1000);
    expect(problems).toEqual([]);
  });

  test("setiap aturan menyebut berapa lama kondisi harus bertahan", () => {
    expect(anomalyRules.map((rule) => [rule.kind, rule.forSeconds])).toEqual([
      ["queue", 30],
      ["cpu", 180],
      ["port", 60],
      ["optical", 0],
      ["offline", 30],
    ]);
  });

  test("alert muncul tepat saat detectedAt, bukan sebelumnya", () => {
    // Pilih alert yang aturannya punya masa tunggu (bukan sinyal optik).
    const current = mockActiveAlerts(NOW);
    const alert = current.find((item) => item.detectedAt > item.startedAt)!;
    expect(alert).toBeTruthy();
    const ids = (now: number) => mockActiveAlerts(now).map((item) => item.id);
    expect(ids(alert.detectedAt - 1)).not.toContain(alert.id);
    expect(ids(alert.detectedAt)).toContain(alert.id);
  });

  test("sumber waktu konsisten dengan ketidakpastiannya", () => {
    let events = 0;
    let polls = 0;
    const problems: string[] = [];
    for (const { alert } of everyAlert) {
      if (alert.timeSource === "event") {
        events += 1;
        // Hanya kejadian di router (PPP on-down) yang punya waktu dari router.
        if (alert.kind !== "offline")
          problems.push(`${alert.id}: event bukan offline`);
        if (alert.timeUncertaintySeconds !== 0)
          problems.push(`${alert.id}: event tidak pasti`);
      } else {
        polls += 1;
        if (alert.timeSource !== "poll")
          problems.push(`${alert.id}: sumber tak dikenal`);
        if (alert.timeUncertaintySeconds !== POLL_SECONDS[alert.kind])
          problems.push(`${alert.id}: ketidakpastian polling salah`);
        if (alert.timeUncertaintySeconds <= 0)
          problems.push(`${alert.id}: polling tanpa ketidakpastian`);
      }
    }
    // Kedua sumber benar-benar muncul pada data tiruan.
    expect(events).toBeGreaterThan(0);
    expect(polls).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test("selalu ada alert untuk dilihat, tetapi tidak membanjir", () => {
    const counts = samples.map((now) => mockActiveAlerts(now).length);
    const average =
      counts.reduce((sum, count) => sum + count, 0) / counts.length;
    const empty = counts.filter((count) => count === 0).length / counts.length;
    expect(average).toBeGreaterThan(1.5);
    expect(average).toBeLessThan(4);
    expect(empty).toBeLessThan(0.1);
    expect(Math.max(...counts)).toBeLessThanOrEqual(10);
  });

  test("id unik dan urutannya yang genting dan terbaru di atas", () => {
    for (const now of samples.slice(0, 200)) {
      const alerts = mockActiveAlerts(now);
      expect(new Set(alerts.map((alert) => alert.id)).size).toBe(alerts.length);
      for (let i = 1; i < alerts.length; i += 1) {
        const [a, b] = [alerts[i - 1], alerts[i]];
        const rank = { critical: 0, warning: 1, info: 2 };
        expect(rank[a.severity]).toBeLessThanOrEqual(rank[b.severity]);
        if (a.severity === b.severity) {
          expect(a.startedAt).toBeGreaterThanOrEqual(b.startedAt);
        }
      }
    }
    const base = mockActiveAlerts(NOW)[0];
    const make = (
      id: string,
      severity: ActiveAlert["severity"],
      startedAt: number,
    ) => ({
      ...base,
      id,
      severity,
      startedAt,
    });
    expect(
      sortActiveAlerts([
        make("lama-peringatan", "warning", NOW - 900),
        make("baru-peringatan", "warning", NOW - 100),
        make("lama-kritis", "critical", NOW - 5000),
      ]).map((alert) => alert.id),
    ).toEqual(["lama-kritis", "baru-peringatan", "lama-peringatan"]);
  });
});

test.describe("lokasi kejadian pada alert", () => {
  const customers = new Map(createMockCustomers().map((c) => [c.id, c]));
  const routers = new Map(mockRouters.map((r) => [r.id, r]));

  test("setiap alert punya lokasi yang lengkap dan masuk akal", () => {
    const problems: string[] = [];
    for (const { alert } of everyAlert) {
      const { location } = alert;
      if (location.name.trim().length === 0)
        problems.push(`${alert.id}: nama kosong`);
      // Koordinat selalu berpasangan, dan dalam batas yang sama dengan database.
      if ((location.latitude === null) !== (location.longitude === null))
        problems.push(`${alert.id}: koordinat tidak berpasangan`);
      if (location.latitude !== null) {
        if (Math.abs(location.latitude) > 90)
          problems.push(`${alert.id}: lintang di luar batas`);
        if (Math.abs(location.longitude!) > 180)
          problems.push(`${alert.id}: bujur di luar batas`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("alert pelanggan memakai ODP, alamat, dan titik pelanggan itu sendiri", () => {
    let seen = 0;
    const problems: string[] = [];
    for (const { alert } of everyAlert) {
      if (alert.customerId === null) continue;
      seen += 1;
      const customer = customers.get(alert.customerId)!;
      const want: AlertLocation = {
        name: customer.odpName,
        address: customer.address,
        odpName: customer.odpName,
        latitude: customer.latitude,
        longitude: customer.longitude,
      };
      if (JSON.stringify(alert.location) !== JSON.stringify(want))
        problems.push(`${alert.id}: lokasi bukan milik pelanggannya`);
    }
    expect(seen).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test("alert router memakai nama router dan tidak mengarang titik", () => {
    let seen = 0;
    const problems: string[] = [];
    for (const { alert } of everyAlert) {
      if (alert.customerId !== null) continue;
      seen += 1;
      const want: AlertLocation = {
        name: routers.get(alert.routerId)!.name,
        address: null,
        odpName: null,
        latitude: null,
        longitude: null,
      };
      if (JSON.stringify(alert.location) !== JSON.stringify(want))
        problems.push(`${alert.id}: lokasi router salah`);
    }
    expect(seen).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test("pelanggan yang tidak dikenal jatuh kembali ke lokasi router-nya", () => {
    const base = createMockCustomers()[0];
    expect(
      locationFor({ customerId: base.id, routerId: base.routerId }).name,
    ).toBe(base.odpName);
    // Id pelanggan yang tidak ada (mis. baru dihapus): tidak error, dan tidak
    // mengarang alamat atau titik.
    expect(
      locationFor({ customerId: "tidak-ada", routerId: "router-1" }),
    ).toEqual({
      name: routers.get("router-1")!.name,
      address: null,
      odpName: null,
      latitude: null,
      longitude: null,
    });
  });

  test("router yang tidak dikenal tetap menghasilkan lokasi yang bisa ditulis", () => {
    const location = locationFor({
      customerId: null,
      routerId: "router-hilang",
    });
    expect(location).toEqual({
      name: "Lokasi belum diketahui",
      address: null,
      odpName: null,
      latitude: null,
      longitude: null,
    });
  });

  test("tampilan lokasi: baris utama, alamat, dan apakah ada titik di peta", () => {
    const customer: AlertLocation = {
      name: "ODP-CHP-04",
      address: "Jl. Mawar No. 12",
      odpName: "ODP-CHP-04",
      latitude: -6.9,
      longitude: 107.6,
    };
    expect(describeLocation(customer)).toEqual({
      primary: "ODP-CHP-04",
      secondary: "Jl. Mawar No. 12",
      hasPoint: true,
    });
    const router: AlertLocation = {
      name: "RTR-Barat-02",
      address: null,
      odpName: null,
      latitude: null,
      longitude: null,
    };
    const shown = describeLocation(router);
    expect(shown.primary).toBe("RTR-Barat-02");
    expect(shown.hasPoint).toBe(false);
    expect(shown.secondary).toContain("alert tingkat router");
    // Pelanggan dengan titik tetapi tanpa alamat: tidak ada baris kedua palsu.
    expect(
      describeLocation({ ...customer, address: null }).secondary,
    ).toBeNull();
  });
});

test.describe("tampilan waktu alert", () => {
  const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

  test("jam ditulis sampai detik dan berbeda untuk detik yang berbeda", () => {
    const start = at("2026-10-07T07:32:07");
    const now = start + 300;
    const first = formatAlertTime(start, now);
    expect(first).toBe(
      [
        new Date(start * 1000).getHours(),
        new Date(start * 1000).getMinutes(),
        new Date(start * 1000).getSeconds(),
      ]
        .map((part) => String(part).padStart(2, "0"))
        .join("."),
    );
    expect(first).toMatch(/^\d{2}\.\d{2}\.\d{2}$/);
    expect(formatAlertTime(start + 1, now)).not.toBe(first);
  });

  test("alert dari hari lain disertai tanggalnya", () => {
    const start = at("2026-10-06T23:59:58");
    const sameDay = formatAlertTime(start, start + 1);
    const nextDay = formatAlertTime(start, start + 24 * 3600);
    expect(sameDay).not.toContain(",");
    expect(nextDay).toMatch(/^\d{1,2} \S+, \d{2}\.\d{2}\.\d{2}$/);
    expect(nextDay.endsWith(sameDay)).toBe(true);
  });

  test("penanda sumber waktu menyebut asal dan batas ketelitiannya", () => {
    expect(
      describeTimeSource({ timeSource: "event", timeUncertaintySeconds: 0 })
        .short,
    ).toBe("dari router");
    const cases: [number, string][] = [
      [1, "polling ±1 detik"],
      [10, "polling ±10 detik"],
      [30, "polling ±30 detik"],
      [60, "polling ±1 menit"],
    ];
    for (const [seconds, label] of cases) {
      const text = describeTimeSource({
        timeSource: "poll",
        timeUncertaintySeconds: seconds,
      });
      expect(text.short).toBe(label);
      expect(text.long).toContain("lebih awal");
      expect(text.long).toContain(label.replace("polling ±", ""));
    }
    expect(
      describeTimeSource({ timeSource: "event", timeUncertaintySeconds: 0 })
        .long,
    ).toContain("router");
  });
});
