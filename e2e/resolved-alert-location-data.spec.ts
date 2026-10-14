import { expect, test } from "@playwright/test";
import {
  describeLocation,
  mockResolvedAlerts,
  type ResolvedAlert,
} from "../src/lib/dashboard/alerts";
import { mapFocusHref, readFocusId } from "../src/lib/dashboard/map-focus";
import {
  createMockCustomers,
  mockRouters,
} from "../src/lib/dashboard/mock-data";
import { START } from "./alert-moments";

// Lokasi kejadian pada riwayat alert selesai, sebagai data: harus berasal dari
// pelanggan dan router yang sama dengan yang digambar di peta, selama seluruh
// jendela tujuh hari. Tanpa browser.

const customers = new Map(createMockCustomers().map((c) => [c.id, c]));
const routers = new Map(mockRouters.map((r) => [r.id, r]));
const customerKinds = ["offline", "optical"];

// Seluruh riwayat pada beberapa momen yang berjauhan, tanpa alert yang dihitung dua kali.
function everyResolvedAlert() {
  const found = new Map<string, ResolvedAlert>();
  for (let day = 0; day < 28; day += 7) {
    const now = START + day * 86_400 + 6 * 86_400;
    for (const alert of mockResolvedAlerts(now)) found.set(alert.id, alert);
  }
  return [...found.values()];
}

test.describe("lokasi alert selesai", () => {
  const all = everyResolvedAlert();

  test("cukup banyak alert untuk diperiksa, dari kedua jenis", () => {
    expect(all.length).toBeGreaterThan(1_500);
    expect(all.some((a) => a.customerId !== null)).toBe(true);
    expect(all.some((a) => a.customerId === null)).toBe(true);
  });

  test("alert pelanggan: titik, ODP, dan alamat sama dengan pelanggan di peta", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const alert of all) {
      if (alert.customerId === null) continue;
      checked += 1;
      const customer = customers.get(alert.customerId);
      if (!customer) {
        problems.push(`${alert.id}: pelanggan ${alert.customerId} tidak ada`);
        continue;
      }
      const { location } = alert;
      if (location.latitude !== customer.latitude)
        problems.push(`${alert.id}: lintang berbeda`);
      if (location.longitude !== customer.longitude)
        problems.push(`${alert.id}: bujur berbeda`);
      if (location.odpName !== (customer.odpName || null))
        problems.push(`${alert.id}: ODP berbeda`);
      if (location.address !== (customer.address || null))
        problems.push(`${alert.id}: alamat berbeda`);
      if (
        location.name !==
        (customer.odpName || customer.address || customer.name)
      )
        problems.push(`${alert.id}: nama lokasi salah`);
      // Router alert ini adalah router pelanggannya.
      if (alert.routerId !== customer.routerId)
        problems.push(`${alert.id}: router bukan milik pelanggan`);
    }
    expect(checked).toBeGreaterThan(500);
    expect(problems).toEqual([]);
  });

  test("alert router: nama router, tanpa titik, dan tanpa tautan sorot", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const alert of all) {
      if (alert.customerId !== null) continue;
      checked += 1;
      const router = routers.get(alert.routerId);
      if (!router) {
        problems.push(`${alert.id}: router ${alert.routerId} tidak ada`);
        continue;
      }
      const { location } = alert;
      if (location.name !== router.name) problems.push(`${alert.id}: nama`);
      if (location.latitude !== null || location.longitude !== null)
        problems.push(`${alert.id}: titik dikarang untuk router`);
      if (location.address !== null || location.odpName !== null)
        problems.push(`${alert.id}: alamat atau ODP untuk router`);
      const shown = describeLocation(location);
      if (shown.hasPoint) problems.push(`${alert.id}: dianggap punya titik`);
      if (!shown.secondary) problems.push(`${alert.id}: tanpa penjelasan`);
    }
    expect(checked).toBeGreaterThan(500);
    expect(problems).toEqual([]);
  });

  test("jenis menentukan pemiliknya: offline dan optik milik pelanggan, antrean, CPU, dan port milik router", () => {
    const wrong = all.filter(
      (alert) =>
        customerKinds.includes(alert.kind) !== (alert.customerId !== null),
    );
    expect(wrong.map((alert) => `${alert.id}:${alert.kind}`)).toEqual([]);
  });

  test("setiap alert pelanggan punya tautan sorot yang terbaca kembali ke pelanggan yang sama", () => {
    const problems: string[] = [];
    for (const alert of all) {
      if (alert.customerId === null) continue;
      const href = mapFocusHref(alert.customerId);
      if (href === null) {
        problems.push(`${alert.id}: tanpa tautan`);
        continue;
      }
      const focus = new URL(href, "http://x").searchParams.get("focus");
      if (readFocusId(focus ?? undefined) !== alert.customerId)
        problems.push(`${alert.id}: tautan tidak kembali ke pelanggan`);
    }
    expect(problems).toEqual([]);
  });

  test("pelanggan yang sama selalu di tempat yang sama, juga pada alert yang berbeda", () => {
    const seen = new Map<string, string>();
    const moved: string[] = [];
    for (const alert of all) {
      if (alert.customerId === null) continue;
      const place = JSON.stringify(alert.location);
      const before = seen.get(alert.customerId);
      if (before !== undefined && before !== place)
        moved.push(`${alert.customerId}: ${alert.id}`);
      seen.set(alert.customerId, place);
    }
    expect(seen.size).toBeGreaterThan(30);
    expect(moved).toEqual([]);
  });

  test("titik semua alert pelanggan berada di dalam batas peta yang sama", () => {
    const points = [...customers.values()];
    const bounds = {
      south: Math.min(...points.map((c) => c.latitude)),
      north: Math.max(...points.map((c) => c.latitude)),
      west: Math.min(...points.map((c) => c.longitude)),
      east: Math.max(...points.map((c) => c.longitude)),
    };
    const outside = all.filter(
      (alert) =>
        alert.location.latitude !== null &&
        (alert.location.latitude < bounds.south ||
          alert.location.latitude > bounds.north ||
          alert.location.longitude! < bounds.west ||
          alert.location.longitude! > bounds.east),
    );
    expect(outside.map((alert) => alert.id)).toEqual([]);
  });
});
