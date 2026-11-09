import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();

const { classifyAlertCategory, summarizeAlertCategories, ALERT_CATEGORY_MAP } =
  await import("../src/lib/dashboard/alert-categories.ts");
const { filterResolvedAlerts, defaultResolvedFilters } =
  await import("../src/lib/dashboard/resolved-filter.ts");

test("classifyAlertCategory: membedakan optik, core, dan pelanggan offline", () => {
  // Optik: diputuskan oleh kind/type
  assert.equal(
    classifyAlertCategory({ kind: "optical", customerId: "c1" }),
    "optical",
  );
  assert.equal(
    classifyAlertCategory({ type: "optical", title: "Sinyal optik lemah" }),
    "optical",
  );

  // Pelanggan offline
  assert.equal(
    classifyAlertCategory({ kind: "offline", customerId: "c-123" }),
    "customer",
  );
  assert.equal(
    classifyAlertCategory({
      type: "offline",
      customerId: "c-456",
      title: "Pelanggan offline",
    }),
    "customer",
  );

  // Router Core unreachable
  assert.equal(
    classifyAlertCategory({
      kind: "offline",
      customerId: null,
      routerId: "r-1",
    }),
    "core",
  );
  assert.equal(
    classifyAlertCategory({
      type: "offline",
      title: "Router tidak terjangkau",
    }),
    "core",
  );

  // Perangkat Core lainnya (CPU, queue, port)
  assert.equal(classifyAlertCategory({ kind: "cpu" }), "core");
  assert.equal(classifyAlertCategory({ kind: "queue" }), "core");
  assert.equal(classifyAlertCategory({ kind: "port" }), "core");
  assert.equal(
    classifyAlertCategory({ type: "cpu", title: "CPU router tinggi" }),
    "core",
  );
  assert.equal(
    classifyAlertCategory({ type: "queue", title: "Antrean penuh" }),
    "core",
  );

  // Lainnya
  assert.equal(classifyAlertCategory({ kind: "billing_mismatch" }), "other");
  assert.equal(classifyAlertCategory({}), "other");
});

test("summarizeAlertCategories: menghitung setiap kategori dan total secara presisi", () => {
  const alerts = [
    { kind: "optical", customerId: "c1" },
    { kind: "optical", customerId: "c2" },
    { kind: "offline", customerId: "c3" },
    { kind: "offline", customerId: null, routerId: "r1" },
    { kind: "cpu", routerId: "r1" },
    { kind: "unknown" },
  ];

  const summary = summarizeAlertCategories(alerts);
  assert.equal(summary.all, 6);
  assert.equal(summary.optical, 2);
  assert.equal(summary.customer, 1);
  assert.equal(summary.core, 2); // 1 router offline + 1 cpu
  assert.equal(summary.other, 1);
});

test("filterResolvedAlerts: menyaring riwayat berdasarkan kategori", () => {
  const loc = {
    name: "Lokasi",
    address: null,
    odpName: null,
    latitude: null,
    longitude: null,
  };
  const directory = {
    routerName: () => "Core CIARA",
    customer: () => ({ name: "Budi", pppoeUsername: "budi" }),
  };

  const resolved = [
    {
      id: "a1",
      kind: "optical",
      severity: "warning",
      startedAt: 100,
      endedAt: 200,
      routerId: "r1",
      customerId: "c1",
      location: loc,
      timeSource: "poll",
      timeUncertaintySeconds: 30,
      endTimeSource: "poll",
      endTimeUncertaintySeconds: 30,
      handledBy: null,
      interfaceName: null,
      measured: -27.5,
    },
    {
      id: "a2",
      kind: "offline",
      severity: "warning",
      startedAt: 100,
      endedAt: 200,
      routerId: "r1",
      customerId: "c1",
      location: loc,
      timeSource: "poll",
      timeUncertaintySeconds: 30,
      endTimeSource: "poll",
      endTimeUncertaintySeconds: 30,
      handledBy: null,
      interfaceName: null,
      measured: null,
    },
    {
      id: "a3",
      kind: "cpu",
      severity: "critical",
      startedAt: 100,
      endedAt: 200,
      routerId: "r1",
      customerId: null,
      location: loc,
      timeSource: "poll",
      timeUncertaintySeconds: 5,
      endTimeSource: "poll",
      endTimeUncertaintySeconds: 5,
      handledBy: null,
      interfaceName: null,
      measured: 92,
    },
  ];

  // Filter category optical
  const optik = filterResolvedAlerts(
    resolved,
    { ...defaultResolvedFilters, category: "optical" },
    300,
    directory,
  );
  assert.equal(optik.length, 1);
  assert.equal(optik[0].id, "a1");

  // Filter category customer
  const cust = filterResolvedAlerts(
    resolved,
    { ...defaultResolvedFilters, category: "customer" },
    300,
    directory,
  );
  assert.equal(cust.length, 1);
  assert.equal(cust[0].id, "a2");

  // Filter category core
  const core = filterResolvedAlerts(
    resolved,
    { ...defaultResolvedFilters, category: "core" },
    300,
    directory,
  );
  assert.equal(core.length, 1);
  assert.equal(core[0].id, "a3");
});

test("ALERT_CATEGORY_MAP memuat metadata lengkap (label, icon, badgeClass)", () => {
  for (const key of ["core", "optical", "customer", "other"]) {
    const meta = ALERT_CATEGORY_MAP[key];
    assert.ok(meta);
    assert.equal(meta.key, key);
    assert.ok(meta.label.length > 0);
    assert.ok(meta.shortLabel.length > 0);
    assert.ok(meta.badgeClass.length > 0);
    assert.ok(meta.Icon);
  }
});
