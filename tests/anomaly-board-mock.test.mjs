import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { ANOMALY_DETECTION_MOCK_ENTRY, loadAnomalies } = await import(
  "../src/lib/dashboard/anomaly-feed.ts"
);
const {
  anomalyRules,
  describeAnomaly,
  summarizeAnomalies,
  summarizeByKind,
  isActive,
} = await import("../src/lib/dashboard/anomalies.ts");
const { SETUP_DATA_SOURCE_REGISTRY } = await import(
  "../src/lib/dashboard/setup-extended.ts"
);
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const NOW = 1_760_000_000;
const anomalies = await loadAnomalies(NOW);

test("ANOMALY_DETECTION_MOCK_ENTRY terdaftar di registry", () => {
  assert.ok(SETUP_DATA_SOURCE_REGISTRY.length >= 14);
  assert.ok(SETUP_DATA_SOURCE_REGISTRY.includes(ANOMALY_DETECTION_MOCK_ENTRY));
  assert.equal(ANOMALY_DETECTION_MOCK_ENTRY.id, "anomaly-detection-feed");
  assert.equal(ANOMALY_DETECTION_MOCK_ENTRY.status, "dummy");
  assert.equal(ANOMALY_DETECTION_MOCK_ENTRY.envKey, "DASHBOARD_DATA");
  assert.match(ANOMALY_DETECTION_MOCK_ENTRY.notes, /Fase 5/);
});

test("loadAnomalies: array anomali berisi field valid", () => {
  assert.ok(anomalies.length > 0);
  const kinds = anomalyRules.map((r) => r.kind);
  const ids = new Set();
  for (const a of anomalies) {
    assert.equal(typeof a.id, "string");
    assert.ok(!ids.has(a.id), "id unik");
    ids.add(a.id);
    assert.ok(kinds.includes(a.kind));
    assert.ok(["critical", "warning", "info"].includes(a.severity));
    assert.ok(Number.isInteger(a.startedAt) && a.startedAt <= NOW);
    assert.ok(a.endedAt === null || a.endedAt >= a.startedAt);
    // "offline" tidak punya ukuran; lainnya wajib angka.
    if (a.kind === "offline") assert.equal(a.measured, null);
    else assert.equal(typeof a.measured, "number");
    // ambang berasal dari aturan deteksi
    const rule = anomalyRules.find((r) => r.kind === a.kind);
    assert.ok(rule.forSeconds >= 0);
  }
  // deterministik untuk waktu yang sama
  return loadAnomalies(NOW).then((again) =>
    assert.deepEqual(again, anomalies),
  );
});

test("summarizeAnomalies: hitungan aktif, 24 jam, total, tersering", () => {
  const s = summarizeAnomalies(anomalies, NOW);
  assert.equal(s.total, anomalies.length);
  assert.equal(s.active, anomalies.filter(isActive).length);
  assert.equal(
    s.activeCritical,
    anomalies.filter((a) => isActive(a) && a.severity === "critical").length,
  );
  assert.equal(
    s.activeWarning,
    anomalies.filter((a) => isActive(a) && a.severity === "warning").length,
  );
  assert.equal(
    s.last24h,
    anomalies.filter((a) => a.startedAt >= NOW - 86400).length,
  );
  assert.ok(s.last24hResolved <= s.last24h);
  assert.ok(s.topKind && s.topKind.count > 0);

  const empty = summarizeAnomalies([], NOW);
  assert.equal(empty.total, 0);
  assert.equal(empty.active, 0);
  assert.equal(empty.topKind, null);
});

test("summarizeByKind: satu ringkasan per aturan, jumlah cocok", () => {
  const kinds = summarizeByKind(anomalies, NOW);
  assert.deepEqual(
    kinds.map((k) => k.kind),
    anomalyRules.map((r) => r.kind),
  );
  assert.equal(
    kinds.reduce((n, k) => n + k.total, 0),
    anomalies.length,
  );
  assert.equal(
    kinds.reduce((n, k) => n + k.active, 0),
    anomalies.filter(isActive).length,
  );
  const empty = summarizeByKind([], NOW);
  assert.equal(empty.length, anomalyRules.length);
  assert.ok(empty.every((k) => k.total === 0 && k.latest === null));
});

test("describeAnomaly: teks per jenis", () => {
  assert.equal(
    describeAnomaly({ kind: "cpu", interfaceName: null, measured: 90 }),
    "CPU 90% (batas 85%)",
  );
  assert.equal(
    describeAnomaly({ kind: "queue", interfaceName: "ether1", measured: 97 }),
    "Antrean ether1 97% (batas 95%)",
  );
  assert.equal(
    describeAnomaly({ kind: "port", interfaceName: "sfp1", measured: 30 }),
    "sfp1: 30 error/menit (batas 20)",
  );
  assert.match(
    describeAnomaly({ kind: "optical", interfaceName: null, measured: -27 }),
    /Rx .*dBm.*batas/,
  );
  assert.equal(
    describeAnomaly({ kind: "offline", interfaceName: null, measured: null }),
    "Tidak ada sesi PPPoE (batas 30 detik)",
  );
  for (const a of anomalies) assert.ok(describeAnomaly(a).length > 0);
});

test("AnomalyBoard: test id dan badge tiruan", () => {
  const src = read("../src/components/dashboard/anomaly-board.tsx");
  for (const id of ["anomaly-mock-badge", "anomaly-board", "anomaly-row"]) {
    assert.match(src, new RegExp(`data-testid="${id}"`));
  }
  assert.match(src, /Data Tiruan Anomali \(Fase 2\)/);
  assert.match(src, /Rule Engine nyata di\s+Fase\s+5/);
});
