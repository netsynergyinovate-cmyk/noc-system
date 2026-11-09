import test from "node:test";
import assert from "node:assert/strict";

const { anomalyRangeStart, anomalyRangeInfo, anomalyRanges } =
  await import("../src/lib/dashboard/anomaly-range.ts");
const { loadAnomalies } = await import("../src/lib/dashboard/anomaly-feed.ts");
const { isActive } = await import("../src/lib/dashboard/anomalies.ts");

const NOW = 1_791_450_000;

test("awal periode: 7 hari, 30 hari, semua (tanpa batas), dan hari ini = tengah malam lokal", () => {
  assert.equal(anomalyRangeStart("7d", NOW), NOW - 7 * 86_400);
  assert.equal(anomalyRangeStart("30d", NOW), NOW - 30 * 86_400);
  assert.equal(anomalyRangeStart("all", NOW), null);
  const start = anomalyRangeStart("today", NOW);
  assert.ok(start <= NOW && NOW - start < 86_400 + 3_600);
  const d = new Date(start * 1000);
  assert.deepEqual([d.getHours(), d.getMinutes(), d.getSeconds()], [0, 0, 0]);
  assert.deepEqual(
    anomalyRanges.map((r) => r.tab),
    ["Hari ini", "7 hari", "1 bulan", "Semua"],
  );
  assert.equal(anomalyRangeInfo("7d").phrase, "dalam 7 hari terakhir");
});

test("periode lebih panjang memuat lebih banyak riwayat, dan yang aktif selalu ikut", async () => {
  const sizes = {};
  for (const range of ["today", "7d", "30d", "all"]) {
    const list = await loadAnomalies(NOW, range);
    sizes[range] = list.length;
    const start = anomalyRangeStart(range, NOW);
    for (const a of list) {
      if (!isActive(a) && start !== null)
        assert.ok(a.startedAt >= start - 86_400 * 2);
    }
  }
  if (sizes.all === 0) return;
  assert.ok(sizes.today <= sizes["7d"]);
  assert.ok(sizes["7d"] < sizes["30d"]);
  assert.ok(sizes["30d"] <= sizes.all);
});
