import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { loadAnomalies } = await import("../src/lib/dashboard/anomaly-feed.ts");
const { anomalyRules } = await import("../src/lib/dashboard/anomalies.ts");
const { defaultAnomalyFilters, filterAnomalies, hasActiveAnomalyFilters } =
  await import("../src/lib/dashboard/anomaly-filter.ts");
const {
  getAnomalyTroubleshootingSteps,
  markAnomalyReviewed,
  isAnomalyReviewed,
  getReviewedAnomalies,
  clearReviewedAnomalies,
} = await import("../src/lib/dashboard/anomaly-detail-logic.ts");
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const anomalies = await loadAnomalies(1_760_000_000);

test("filter: default tidak aktif, query/routerId mengaktifkan", () => {
  assert.equal(hasActiveAnomalyFilters(defaultAnomalyFilters), false);
  assert.equal(
    hasActiveAnomalyFilters({ ...defaultAnomalyFilters, query: "  " }),
    false,
  );
  assert.equal(
    hasActiveAnomalyFilters({ ...defaultAnomalyFilters, query: "cpu" }),
    true,
  );
  assert.equal(
    hasActiveAnomalyFilters({ ...defaultAnomalyFilters, routerId: "x" }),
    true,
  );
  assert.deepEqual(
    filterAnomalies(anomalies, defaultAnomalyFilters),
    anomalies,
  );
});

test("filterAnomalies: query teks (tanpa huruf besar/kecil) dan routerId", () => {
  const cpu = filterAnomalies(anomalies, {
    ...defaultAnomalyFilters,
    query: "CPU",
  });
  assert.ok(cpu.length > 0);
  assert.ok(cpu.every((a) => a.kind === "cpu" || a.measured !== null));
  assert.ok(cpu.some((a) => a.kind === "cpu"));

  const routerId = anomalies[0].routerId;
  const byRouter = filterAnomalies(anomalies, {
    ...defaultAnomalyFilters,
    routerId,
  });
  assert.ok(byRouter.length > 0);
  assert.ok(byRouter.every((a) => a.routerId === routerId));
  assert.equal(
    byRouter.length,
    anomalies.filter((a) => a.routerId === routerId).length,
  );

  const lookup = {
    routerNames: new Map([[routerId, "Router Zeta"]]),
    customerById: new Map(),
  };
  const byName = filterAnomalies(
    anomalies,
    { ...defaultAnomalyFilters, query: "zeta" },
    lookup,
  );
  assert.deepEqual(
    byName.map((a) => a.id),
    byRouter.map((a) => a.id),
  );
  assert.equal(
    filterAnomalies(anomalies, { ...defaultAnomalyFilters, query: "zzzqqq" })
      .length,
    0,
  );
});

test("status 'unreviewed': aktif yang belum ditinjau; yang ditinjau tetap 'aktif'", async () => {
  const { facetCounts } = await import("../src/lib/dashboard/anomaly-filter.ts");
  const { isActive } = await import("../src/lib/dashboard/anomalies.ts");
  // Waktu pada data tiruan yang punya sedikitnya dua anomali aktif.
  let anomalies = [];
  for (let t = 1_791_400_000; t < 1_791_400_000 + 7 * 86_400; t += 900) {
    anomalies = await loadAnomalies(t);
    if (anomalies.filter(isActive).length >= 2) break;
  }
  const active = anomalies.filter(isActive);
  assert.ok(active.length >= 2, "data uji harus punya sedikitnya dua anomali aktif");
  const reviewed = { [active[0].id]: { by: "Budi" } };

  const ids = (status) =>
    filterAnomalies(
      anomalies,
      { ...defaultAnomalyFilters, status },
      undefined,
      reviewed,
    ).map((a) => a.id);
  assert.equal(ids("active").length, active.length);
  assert.deepEqual(
    ids("unreviewed"),
    active.slice(1).map((a) => a.id),
  );
  // Tanpa peta ditinjau, "belum selesai" sama dengan "aktif".
  assert.equal(
    filterAnomalies(anomalies, { ...defaultAnomalyFilters, status: "unreviewed" })
      .length,
    active.length,
  );

  const counts = facetCounts(anomalies, defaultAnomalyFilters, undefined, reviewed);
  assert.equal(counts.status.active, active.length);
  assert.equal(counts.status.unreviewed, active.length - 1);
  assert.equal(counts.status.resolved, anomalies.length - active.length);
});

test("getAnomalyTroubleshootingSteps: panduan per jenis", () => {
  const cli = {
    queue: "/queue simple print",
    cpu: "/tool profile",
    port: "/interface ethernet monitor [find]",
    optical: "show pon power olt",
  };
  for (const rule of anomalyRules) {
    const g = getAnomalyTroubleshootingSteps({ kind: rule.kind });
    assert.ok(g.rootCauseHypothesis.length > 0);
    assert.ok(g.steps.length > 0);
    assert.equal(g.cliHelp, cli[rule.kind]);
  }
  assert.match(
    getAnomalyTroubleshootingSteps({ kind: "offline" }).steps[0],
    /listrik padam/,
  );
});

test("penandaan ditinjau (fallback memori tanpa localStorage)", () => {
  clearReviewedAnomalies();
  assert.equal(isAnomalyReviewed("a1"), false);
  const r = markAnomalyReviewed("a1", "Budi");
  assert.equal(r.anomalyId, "a1");
  assert.equal(r.operator, "Budi");
  assert.ok(!Number.isNaN(Date.parse(r.reviewedAt)));
  assert.equal(isAnomalyReviewed("a1"), true);
  assert.equal(isAnomalyReviewed("a2"), false);
  assert.equal(getReviewedAnomalies().a1.operator, "Budi");
  clearReviewedAnomalies();
  assert.deepEqual(getReviewedAnomalies(), {});
});

test("AnomalyDetailDialog dan integrasi di anomaly-board", () => {
  const dialog = read("../src/components/dashboard/anomaly-detail-dialog.tsx");
  assert.match(dialog, /export function AnomalyDetailDialog/);
  for (const id of [
    "anomaly-detail-dialog",
    "anomaly-detail-close",
    "mark-anomaly-handled-btn",
  ]) {
    assert.match(dialog, new RegExp(`data-testid="${id}"`));
  }
  assert.match(dialog, /Rincian Deteksi Anomali/);
  const board = read("../src/components/dashboard/anomaly-board.tsx");
  assert.match(board, /<AnomalyDetailDialog/);
  assert.match(board, /data-testid="view-anomaly-detail-btn"/);
  assert.match(board, /Ditinjau/);
  const filters = read("../src/components/dashboard/anomaly-filters.tsx");
  assert.match(filters, /data-testid="anomaly-search-input"/);
});
