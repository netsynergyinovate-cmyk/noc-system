import { expect, test } from "@playwright/test";
import {
  mockResolvedAlerts,
  type ResolvedAlert,
} from "../src/lib/dashboard/alerts";
import { incidentLabels } from "../src/lib/dashboard/incidents";
import {
  createMockCustomers,
  mockRouters,
} from "../src/lib/dashboard/mock-data";
import { unit } from "../src/lib/dashboard/mock-random";
import {
  defaultResolvedFilters,
  filterResolvedAlerts,
  hasActiveResolvedFilters,
  resolvedFacetCounts,
  resolvedWindowSeconds,
  searchableText,
  searchTerms,
  type ResolvedFilters,
  type ResolvedWindow,
  type SubjectDirectory,
} from "../src/lib/dashboard/resolved-filter";
import type {
  IncidentKind,
  IncidentSeverity,
} from "../src/lib/dashboard/types";
import { START } from "./alert-moments";

// Pencarian dan saringan riwayat alert selesai: setiap saringan sendiri, semuanya
// bersama, pencarian per kata, dan angka di samping pilihan (yang harus sama
// persis dengan hasil bila pilihannya dipilih). Tanpa browser.

const NOW = START + 6 * 86_400 + 1_234;
const alerts = mockResolvedAlerts(NOW);
const customers = new Map(createMockCustomers().map((c) => [c.id, c]));
const routers = new Map(mockRouters.map((r) => [r.id, r]));
const routerIds = mockRouters.map((r) => r.id);
const directory: SubjectDirectory = {
  routerName: (id) => routers.get(id)?.name,
  customer: (id) => customers.get(id),
};

const kinds: IncidentKind[] = ["offline", "optical", "queue", "cpu", "port"];
const severities: IncidentSeverity[] = ["critical", "warning", "info"];
const windows: ResolvedWindow[] = ["all", "1h", "6h", "24h"];

const filter = (partial: Partial<ResolvedFilters>) =>
  filterResolvedAlerts(
    alerts,
    { ...defaultResolvedFilters, ...partial },
    NOW,
    directory,
  );
const ids = (list: ResolvedAlert[]) => list.map((alert) => alert.id);

test.describe("saringan riwayat alert", () => {
  test("tanpa saringan semuanya tampil, dalam urutan yang sama", () => {
    expect(alerts.length).toBeGreaterThan(300);
    expect(ids(filter({}))).toEqual(ids(alerts));
    expect(hasActiveResolvedFilters(defaultResolvedFilters)).toBe(false);
    // Spasi saja bukan kata kunci.
    expect(
      hasActiveResolvedFilters({ ...defaultResolvedFilters, query: "   " }),
    ).toBe(false);
    expect(ids(filter({ query: "   " }))).toEqual(ids(alerts));
    for (const change of [
      { query: "a" },
      { kind: "cpu" },
      { severity: "info" },
      { routerId: routerIds[0] },
      { window: "1h" },
    ] as Partial<ResolvedFilters>[]) {
      expect(
        hasActiveResolvedFilters({ ...defaultResolvedFilters, ...change }),
      ).toBe(true);
    }
  });

  test("jenis, tingkat, dan router masing-masing sama dengan penyaringan biasa", () => {
    for (const kind of kinds) {
      expect(ids(filter({ kind }))).toEqual(
        ids(alerts.filter((a) => a.kind === kind)),
      );
    }
    for (const severity of severities) {
      expect(ids(filter({ severity }))).toEqual(
        ids(alerts.filter((a) => a.severity === severity)),
      );
    }
    for (const routerId of routerIds) {
      expect(ids(filter({ routerId }))).toEqual(
        ids(alerts.filter((a) => a.routerId === routerId)),
      );
    }
    expect(filter({ routerId: "tidak-ada" })).toEqual([]);
  });

  test("selesai dalam: batasnya tegas sampai satu detik", () => {
    for (const option of ["1h", "6h", "24h"] as const) {
      const seconds = resolvedWindowSeconds[option];
      const expected = alerts.filter((a) => a.endedAt > NOW - seconds);
      expect(ids(filter({ window: option }))).toEqual(ids(expected));
      expect(expected.length).toBeGreaterThan(0);
      expect(expected.length).toBeLessThan(alerts.length);
      // Yang selesai tepat di batas sudah di luar, sedetik sesudahnya masih di dalam.
      const inside = filterResolvedAlerts(
        [{ ...alerts[0], endedAt: NOW - seconds + 1 }],
        { ...defaultResolvedFilters, window: option },
        NOW,
        directory,
      );
      const edge = filterResolvedAlerts(
        [{ ...alerts[0], endedAt: NOW - seconds }],
        { ...defaultResolvedFilters, window: option },
        NOW,
        directory,
      );
      expect(inside).toHaveLength(1);
      expect(edge).toHaveLength(0);
    }
  });

  test("semua saringan bersama adalah irisannya, dan urutan daftar tetap", () => {
    for (let seed = 0; seed < 120; seed += 1) {
      const pick = <T>(values: T[], n: number) =>
        values[Math.floor(unit(seed * 31 + n) * values.length)];
      const filters: ResolvedFilters = {
        query:
          unit(seed * 31 + 9) < 0.4
            ? ""
            : pick(["offline", "router", "bbt", "a", "port"], 10),
        kind: unit(seed * 31 + 1) < 0.5 ? "all" : pick(kinds, 2),
        severity: unit(seed * 31 + 3) < 0.5 ? "all" : pick(severities, 4),
        routerId: unit(seed * 31 + 5) < 0.5 ? "all" : pick(routerIds, 6),
        window: pick(windows, 7),
      };
      const terms = searchTerms(filters.query);
      const expected = alerts.filter(
        (a) =>
          (filters.kind === "all" || a.kind === filters.kind) &&
          (filters.severity === "all" || a.severity === filters.severity) &&
          (filters.routerId === "all" || a.routerId === filters.routerId) &&
          (filters.window === "all" ||
            a.endedAt > NOW - resolvedWindowSeconds[filters.window]) &&
          terms.every((term) => searchableText(a, directory).includes(term)),
      );
      expect(
        ids(filterResolvedAlerts(alerts, filters, NOW, directory)),
        JSON.stringify(filters),
      ).toEqual(ids(expected));
    }
  });
});

test.describe("pencarian riwayat alert", () => {
  const withCustomer = alerts.filter((a) => a.customerId !== null);
  const sample = withCustomer[7];
  const sampleCustomer = customers.get(sample.customerId!)!;

  test("menemukan alert dari nama pelanggan, username PPPoE, router, ODP, alamat, dan jenisnya", () => {
    const queries: Array<[string, (a: ResolvedAlert) => boolean]> = [
      [sampleCustomer.name, (a) => a.customerId === sampleCustomer.id],
      [sampleCustomer.pppoeUsername, (a) => a.customerId === sampleCustomer.id],
      [
        routers.get(sample.routerId)!.name,
        (a) => a.routerId === sample.routerId,
      ],
      [
        sampleCustomer.odpName,
        (a) => a.location.odpName === sampleCustomer.odpName,
      ],
      [
        sampleCustomer.address,
        (a) => a.location.address === sampleCustomer.address,
      ],
      [incidentLabels[sample.kind], (a) => a.kind === sample.kind],
    ];
    for (const [query, belongs] of queries) {
      const found = filter({ query });
      expect(
        found.map((a) => a.id),
        query,
      ).toContain(sample.id);
      // Setiap hasil memang memuat katanya, dan yang pasti cocok tidak terlewat.
      for (const alert of found) {
        for (const term of searchTerms(query)) {
          expect(
            searchableText(alert, directory),
            `${query} @ ${alert.id}`,
          ).toContain(term);
        }
      }
      for (const alert of alerts.filter(belongs)) {
        expect(
          found.map((a) => a.id),
          `${query} -> ${alert.id}`,
        ).toContain(alert.id);
      }
    }
  });

  test("tidak peka huruf besar dan kecil, dan spasi di pinggir tidak berpengaruh", () => {
    const query = sampleCustomer.name;
    const base = ids(filter({ query }));
    expect(base.length).toBeGreaterThan(0);
    expect(ids(filter({ query: query.toUpperCase() }))).toEqual(base);
    expect(ids(filter({ query: query.toLowerCase() }))).toEqual(base);
    expect(ids(filter({ query: `   ${query}   ` }))).toEqual(base);
  });

  test("beberapa kata semuanya harus ada, dalam urutan apa pun", () => {
    const [first, last] = sampleCustomer.name.split(" ");
    const both = ids(filter({ query: `${first} ${last}` }));
    expect(both).toEqual(ids(filter({ query: `${last}    ${first}` })));
    expect(both).toContain(sample.id);
    // Lebih sempit atau sama dengan masing-masing kata sendiri.
    const onlyFirst = new Set(ids(filter({ query: first })));
    const onlyLast = new Set(ids(filter({ query: last })));
    for (const id of both) {
      expect(onlyFirst.has(id) && onlyLast.has(id)).toBe(true);
    }
    // Kata yang tidak ada mematikan seluruh pencarian.
    expect(filter({ query: `${first} zzzz-tidak-ada` })).toEqual([]);
  });

  test("tanda baca dan tanda regex dibaca apa adanya", () => {
    for (const query of ["(", ")", "[", ".*", "+", "?", "\\", "%", "(batas"]) {
      const found = filter({ query });
      const needle = query.toLowerCase();
      for (const alert of found) {
        expect(searchableText(alert, directory)).toContain(needle);
      }
    }
    // "%" muncul pada angka terukur, dan "(batas" pada keterangan.
    expect(filter({ query: "(batas" }).length).toBeGreaterThan(0);
    expect(filter({ query: ".*" })).toEqual(
      alerts.filter((a) => searchableText(a, directory).includes(".*")),
    );
  });

  test("id alert tidak ikut dicari, karena tidak tampil di layar", () => {
    for (const alert of alerts.slice(0, 50)) {
      expect(searchableText(alert, directory)).not.toContain(alert.id);
    }
    expect(filter({ query: sample.id })).toEqual([]);
  });

  test("alert router dicari lewat nama routernya, bukan nama pelanggan", () => {
    const router = alerts.find((a) => a.customerId === null)!;
    const name = routers.get(router.routerId)!.name;
    expect(searchableText(router, directory)).toContain(name.toLowerCase());
    expect(ids(filter({ query: name }))).toContain(router.id);
  });
});

test.describe("angka di samping pilihan saringan", () => {
  const states = Array.from({ length: 150 }, (_, seed): ResolvedFilters => {
    const pick = <T>(values: T[], n: number) =>
      values[Math.floor(unit(seed * 17 + n) * values.length)];
    return {
      query:
        unit(seed * 17 + 8) < 0.5
          ? ""
          : pick(["offline", "router", "bbt", "ahmad", "cpu", "port"], 9),
      kind: unit(seed * 17 + 1) < 0.5 ? "all" : pick(kinds, 2),
      severity: unit(seed * 17 + 3) < 0.5 ? "all" : pick(severities, 4),
      routerId: unit(seed * 17 + 5) < 0.5 ? "all" : pick(routerIds, 6),
      window: pick(windows, 7),
    };
  });
  const count = (filters: ResolvedFilters) =>
    filterResolvedAlerts(alerts, filters, NOW, directory).length;

  test("memilih sebuah pilihan menghasilkan persis sebanyak angkanya, untuk setiap keadaan saringan", () => {
    for (const filters of states) {
      const counts = resolvedFacetCounts(
        alerts,
        filters,
        NOW,
        directory,
        routerIds,
      );
      const where = JSON.stringify(filters);
      expect(counts.total, where).toBe(count(filters));
      for (const kind of kinds)
        expect(counts.kind[kind], `${where} jenis ${kind}`).toBe(
          count({ ...filters, kind }),
        );
      for (const severity of severities)
        expect(counts.severity[severity], `${where} tingkat ${severity}`).toBe(
          count({ ...filters, severity }),
        );
      for (const routerId of routerIds)
        expect(counts.router[routerId], `${where} router ${routerId}`).toBe(
          count({ ...filters, routerId }),
        );
      for (const window of windows)
        expect(counts.window[window], `${where} jendela ${window}`).toBe(
          count({ ...filters, window }),
        );
    }
  });

  test("jumlah semua pilihan satu saringan sama dengan jumlah yang lolos saringan lainnya", () => {
    for (const filters of states.slice(0, 60)) {
      const counts = resolvedFacetCounts(
        alerts,
        filters,
        NOW,
        directory,
        routerIds,
      );
      const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
      expect(sum(kinds.map((k) => counts.kind[k]))).toBe(
        count({ ...filters, kind: "all" }),
      );
      expect(sum(severities.map((s) => counts.severity[s]))).toBe(
        count({ ...filters, severity: "all" }),
      );
      expect(sum(routerIds.map((r) => counts.router[r]))).toBe(
        count({ ...filters, routerId: "all" }),
      );
      expect(counts.window.all).toBe(count({ ...filters, window: "all" }));
    }
  });

  test("tanpa saringan, angkanya adalah hitungan seluruh riwayat", () => {
    const counts = resolvedFacetCounts(
      alerts,
      defaultResolvedFilters,
      NOW,
      directory,
      routerIds,
    );
    expect(counts.total).toBe(alerts.length);
    for (const kind of kinds)
      expect(counts.kind[kind]).toBe(
        alerts.filter((a) => a.kind === kind).length,
      );
    expect(counts.window.all).toBe(alerts.length);
    expect(counts.window["1h"]).toBeLessThanOrEqual(counts.window["6h"]);
    expect(counts.window["6h"]).toBeLessThanOrEqual(counts.window["24h"]);
    expect(counts.window["24h"]).toBeLessThanOrEqual(counts.window.all);
  });
});
