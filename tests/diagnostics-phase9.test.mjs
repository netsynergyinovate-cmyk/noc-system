import test from "node:test";
import assert from "node:assert/strict";
import {
  compareRuns,
  runSummaryText,
  evaluateFlows,
  evaluateTrafficTrend,
  trafficMinBaselineMbps,
  TRAFFIC_MIN_BASELINE_PLAN_PCT,
  UPLOAD_NEAR_PLAN_PCT,
} from "../src/lib/diagnostics.ts";

const now = new Date("2026-10-25T10:00:00Z");
const src = "uji_fase9";

const row = (direction, peer, port, protocol, bytes, flows = 1) =>
  direction === "up"
    ? {
        direction: "up",
        srcIp: "10.10.10.5",
        dstIp: peer,
        dstPort: port,
        protocol,
        bytes,
        flows,
      }
    : {
        direction: "down",
        srcIp: peer,
        dstIp: "10.10.10.5",
        dstPort: port,
        protocol,
        bytes,
        flows,
      };

test("trafficMinBaselineMbps menghitung batas baseline relatif terhadap paket", () => {
  assert.equal(TRAFFIC_MIN_BASELINE_PLAN_PCT, 2);
  assert.equal(UPLOAD_NEAR_PLAN_PCT, 90);

  // Tanpa paket atau paket tidak valid -> default 1 Mbps
  assert.equal(trafficMinBaselineMbps(null), 1);
  assert.equal(trafficMinBaselineMbps(undefined), 1);
  assert.equal(trafficMinBaselineMbps({ downMbps: null, upMbps: null }), 1);
  assert.equal(trafficMinBaselineMbps({ downMbps: 0, upMbps: 10 }), 1);

  // Paket 10 Mbps -> max(0.5, 10 * 2%) = max(0.5, 0.2) = 0.5 Mbps
  assert.equal(trafficMinBaselineMbps({ downMbps: 10, upMbps: 10 }), 0.5);

  // Paket 50 Mbps -> max(0.5, 50 * 2%) = max(0.5, 1.0) = 1.0 Mbps
  assert.equal(trafficMinBaselineMbps({ downMbps: 50, upMbps: 50 }), 1.0);

  // Paket 100 Mbps -> max(0.5, 100 * 2%) = max(0.5, 2.0) = 2.0 Mbps
  assert.equal(trafficMinBaselineMbps({ downMbps: 100, upMbps: 50 }), 2.0);
});

test("evaluateTrafficTrend: baseline minimum relatif terhadap paket", () => {
  const base = {
    windowUp: 0.2,
    windowPeakDown: 2.0,
    buckets: 12,
  };

  // Kasus 1: Paket 10 Mbps (min baseline = 0.5 Mbps)
  // baselineDown 0.6 Mbps, windowDown 0.2 Mbps (rasio 33% < 50%, baseline >= 0.5) -> meaningfulDrop -> warn
  const res10 = evaluateTrafficTrend(
    {
      ...base,
      windowDown: 0.2,
      baselineDown: 0.6,
      plan: { downMbps: 10, upMbps: 10 },
    },
    src,
    now,
  );
  assert.equal(res10.status, "warn");
  assert.match(res10.value, /paket 10\/10 Mbps/);

  // Kasus 2: Tanpa info paket (min baseline = 1.0 Mbps)
  // baselineDown 0.6 Mbps, windowDown 0.2 Mbps -> di bawah min baseline 1.0 -> ok
  const resNoPlan = evaluateTrafficTrend(
    {
      ...base,
      windowDown: 0.2,
      baselineDown: 0.6,
    },
    src,
    now,
  );
  assert.equal(resNoPlan.status, "ok");
  assert.match(resNoPlan.detail, /biasa memakai di bawah 1 Mbps/);

  // Kasus 3: Paket 10 Mbps, pemakaian sangat rendah pada jam yang kebiasaannya < 0.5 Mbps
  const resLow10 = evaluateTrafficTrend(
    {
      ...base,
      windowDown: 0.1,
      baselineDown: 0.4,
      plan: { downMbps: 10, upMbps: 10 },
    },
    src,
    now,
  );
  assert.equal(resLow10.status, "ok");
  assert.match(resLow10.detail, /biasa memakai di bawah 0\.5 Mbps/);
});

test("evaluateFlows: perbandingan per paket (10 Mbps vs 50 Mbps status berbeda, unknown plan keeps old behavior)", () => {
  // Trafik unggah dominan: 600 MB up vs 400 MB down (60% up)
  const rows = [
    row("up", "1.1.1.1", 443, "TCP", 600e6),
    row("down", "1.1.1.1", 443, "TCP", 400e6),
  ];
  const peakUp = 9.0; // 9 Mbps puncak unggah

  // 1. Paket 10 Mbps: 9 Mbps mendekati batas 10 Mbps (90% >= 90%) -> status: warn
  const res10 = evaluateFlows(rows, src, now, {
    downMbps: 10,
    upMbps: 10,
    peakUpMbps: peakUp,
  });
  const dir10 = res10.find((f) => f.metric === "netflow_direction");
  assert.ok(dir10);
  assert.equal(dir10.status, "warn");
  assert.match(dir10.detail, /mendekati batas paket/);
  assert.match(dir10.value, /paket 10\/10 Mbps/);
  assert.match(dir10.threshold, /puncak unggah < 90% paket/);

  // 2. Paket 50 Mbps: 9 Mbps jauh di bawah batas 50 Mbps (18% < 90%) -> status: ok
  const res50 = evaluateFlows(rows, src, now, {
    downMbps: 50,
    upMbps: 50,
    peakUpMbps: peakUp,
  });
  const dir50 = res50.find((f) => f.metric === "netflow_direction");
  assert.ok(dir50);
  assert.equal(dir50.status, "ok");
  assert.match(dir50.detail, /masih di bawah batas paket 50 Mbps/);
  assert.match(dir50.value, /paket 50\/50 Mbps/);

  // 3. Tanpa paket (unknown plan): mempertahankan perilaku lama
  const resUnknown = evaluateFlows(rows, src, now);
  const dirUnknown = resUnknown.find((f) => f.metric === "netflow_direction");
  assert.ok(dirUnknown);
  assert.equal(dirUnknown.status, "warn");
  assert.match(
    dirUnknown.detail,
    /belum dibandingkan dengan batas unggah paket/,
  );
  assert.equal(dirUnknown.threshold, "unggah < 50%");
});

test("compareRuns: mendeteksi perubahan temuan (worse, better, changed, new, gone, same) dan kesimpulan", () => {
  const baseRun = {
    id: "run-1",
    customerId: "cust-1",
    customerName: "Budi Santoso",
    pppoeUsername: "budi@net",
    triggerMode: "manual",
    triggeredBy: "admin",
    triggerReason: "Keluhan pelanggan",
    triggerSourceRef: null,
    mergedCount: 0,
    lastMergedAt: null,
    status: "done",
    error: null,
    createdAt: "2026-10-25T08:00:00Z",
    startedAt: "2026-10-25T08:00:01Z",
    finishedAt: "2026-10-25T08:00:05Z",
    verdictLayer: "mikrotik",
    verdictDetail: "Queue penuh",
    isSharedFault: false,
    verdictScope: "own",
    verdictRoot: null,
    verdictSecondary: [],
    verdictHeld: false,
    complaintAt: null,
    timeline: [],
  };

  const beforeFindings = [
    {
      id: "f1",
      layer: "mikrotik",
      metric: "queue_usage",
      label: "Pemakaian antrean",
      value: "10 Mbps (100%)",
      threshold: "95%",
      comparator: "<",
      status: "fail",
      detail: "Antrean jenuh",
      sourceRef: "queue",
      sampledAt: null,
      checkedAt: "2026-10-25T08:00:00Z",
    },
    {
      id: "f2",
      layer: "optik",
      metric: "onu_rx",
      label: "Rx ONU",
      value: "-20 dBm",
      threshold: "-24 s.d. -8 dBm",
      comparator: "dalam rentang",
      status: "ok",
      detail: "Sinyal ideal",
      sourceRef: "olt",
      sampledAt: null,
      checkedAt: "2026-10-25T08:00:00Z",
    },
    {
      id: "f3",
      layer: "billing",
      metric: "arrears",
      label: "Tunggakan",
      value: "tidak ada",
      threshold: "0 tagihan",
      comparator: "=",
      status: "ok",
      detail: "Lunas",
      sourceRef: "billing",
      sampledAt: null,
      checkedAt: "2026-10-25T08:00:00Z",
    },
    {
      id: "f4",
      layer: "aktif",
      metric: "ping_customer",
      label: "Ping pelanggan",
      value: "loss 0%",
      threshold: "loss < 2%",
      comparator: "<",
      status: "ok",
      detail: "Ping lancar",
      sourceRef: "ping",
      sampledAt: null,
      checkedAt: "2026-10-25T08:00:00Z",
    },
    {
      id: "f5",
      layer: "log",
      metric: "log_coverage",
      label: "Cakupan log",
      value: "1 jam",
      threshold: ">= 1 jam",
      comparator: "mencakup",
      status: "ok",
      detail: "Cakupan cukup",
      sourceRef: "log",
      sampledAt: null,
      checkedAt: "2026-10-25T08:00:00Z",
    },
  ];

  const afterFindings = [
    // queue_usage: fail -> ok (better)
    {
      id: "f1-b",
      layer: "mikrotik",
      metric: "queue_usage",
      label: "Pemakaian antrean",
      value: "2 Mbps (20%)",
      threshold: "95%",
      comparator: "<",
      status: "ok",
      detail: "Di bawah batas",
      sourceRef: "queue",
      sampledAt: null,
      checkedAt: "2026-10-25T09:00:00Z",
    },
    // onu_rx: ok -> warn (worse)
    {
      id: "f2-b",
      layer: "optik",
      metric: "onu_rx",
      label: "Rx ONU",
      value: "-26 dBm",
      threshold: "-24 s.d. -8 dBm",
      comparator: "dalam rentang",
      status: "warn",
      detail: "Sinyal redam",
      sourceRef: "olt",
      sampledAt: null,
      checkedAt: "2026-10-25T09:00:00Z",
    },
    // arrears: ok -> ok (same, different noisy value)
    {
      id: "f3-b",
      layer: "billing",
      metric: "arrears",
      label: "Tunggakan",
      value: "tidak ada (dicek ulang)",
      threshold: "0 tagihan",
      comparator: "=",
      status: "ok",
      detail: "Lunas",
      sourceRef: "billing",
      sampledAt: null,
      checkedAt: "2026-10-25T09:00:00Z",
    },
    // ping_customer: ok -> unchecked (changed)
    {
      id: "f4-b",
      layer: "aktif",
      metric: "ping_customer",
      label: "Ping pelanggan",
      value: null,
      threshold: null,
      comparator: null,
      status: "unchecked",
      detail: "Pelanggan offline",
      sourceRef: "ping",
      sampledAt: null,
      checkedAt: "2026-10-25T09:00:00Z",
    },
    // f5 (log_coverage) gone!
    // new metric: netflow_direction
    {
      id: "f6",
      layer: "trafik",
      metric: "netflow_direction",
      label: "Arah trafik",
      value: "unggah 80%",
      threshold: "unggah < 50%",
      comparator: "<",
      status: "warn",
      detail: "Unggah dominan",
      sourceRef: "netflow",
      sampledAt: null,
      checkedAt: "2026-10-25T09:00:00Z",
    },
  ];

  const beforeRun = { ...baseRun, findings: beforeFindings };
  const afterRun = {
    ...baseRun,
    id: "run-2",
    createdAt: "2026-10-25T09:00:00Z",
    finishedAt: "2026-10-25T09:00:05Z",
    verdictLayer: "optik",
    verdictDetail: "Sinyal optik redam",
    verdictScope: "own",
    findings: afterFindings,
  };

  const cmp = compareRuns(beforeRun, afterRun);

  assert.equal(cmp.beforeId, "run-1");
  assert.equal(cmp.afterId, "run-2");
  assert.equal(cmp.verdictChanged, true);
  assert.equal(cmp.verdictBefore.layer, "mikrotik");
  assert.equal(cmp.verdictAfter.layer, "optik");
  assert.equal(cmp.sameCount, 1); // arrears is same

  // Changes: onu_rx (worse), queue_usage (better), ping_customer (changed), log_coverage (gone), netflow_direction (new)
  assert.equal(cmp.changes.length, 5);

  const kinds = Object.fromEntries(
    cmp.changes.map((c) => [`${c.layer}:${c.metric}`, c.kind]),
  );
  assert.equal(kinds["optik:onu_rx"], "worse");
  assert.equal(kinds["mikrotik:queue_usage"], "better");
  assert.equal(kinds["aktif:ping_customer"], "changed");
  assert.equal(kinds["log:log_coverage"], "gone");
  assert.equal(kinds["trafik:netflow_direction"], "new");

  // Urutan changes harus mengikuti urutan diagnosticLayers:
  // Layers order: hulu(0), mikrotik(1), log(2), firewall(3), optik(4), ont(5), trafik(6), aktif(7), billing(8)
  const orderedLayers = cmp.changes.map((c) => c.layer);
  const mikrotikIdx = orderedLayers.indexOf("mikrotik");
  const logIdx = orderedLayers.indexOf("log");
  const optikIdx = orderedLayers.indexOf("optik");
  const trafikIdx = orderedLayers.indexOf("trafik");
  const aktifIdx = orderedLayers.indexOf("aktif");

  assert.ok(mikrotikIdx < logIdx);
  assert.ok(logIdx < optikIdx);
  assert.ok(optikIdx < trafikIdx);
  assert.ok(trafikIdx < aktifIdx);
});

test("runSummaryText menghasilkan teks ringkasan deterministik dan lengkap", () => {
  const run = {
    id: "run-100",
    customerId: "cust-42",
    customerName: "Ahmad Dani",
    pppoeUsername: "dani@isp",
    triggerMode: "auto",
    triggeredBy: null,
    triggerReason: "alert_optical",
    mergedCount: 1,
    lastMergedAt: "2026-10-25T10:05:00Z",
    status: "done",
    error: null,
    createdAt: "2026-10-25T10:00:00Z",
    startedAt: "2026-10-25T10:00:01Z",
    finishedAt: "2026-10-25T10:00:06Z",
    verdictLayer: "optik",
    verdictDetail: "Sinyal optik redam (-27 dBm)",
    isSharedFault: false,
    verdictScope: "own",
    verdictRoot: null,
    verdictSecondary: [],
    verdictHeld: false,
    complaintAt: null,
    timeline: [],
    findings: [
      {
        id: "f1",
        layer: "optik",
        metric: "onu_rx",
        label: "Rx ONU",
        value: "-27 dBm",
        threshold: "-24 s.d. -8 dBm",
        comparator: "dalam rentang",
        status: "fail",
        detail: "Sinyal optik sangat lemah (kritis)",
        sourceRef: "olt-1",
        sampledAt: null,
        checkedAt: "2026-10-25T10:00:00Z",
      },
      {
        id: "f2",
        layer: "mikrotik",
        metric: "queue_drop",
        label: "Paket dibuang antrean",
        value: "unduh 12 dari 100 (12.0%)",
        threshold: "1%",
        comparator: "<",
        status: "warn",
        detail: "Antrean membuang paket",
        sourceRef: "queue-1",
        sampledAt: null,
        checkedAt: "2026-10-25T10:00:00Z",
      },
      {
        id: "f3",
        layer: "aktif",
        metric: "traceroute_upstream",
        label: "Traceroute upstream",
        value: null,
        threshold: null,
        comparator: null,
        status: "unchecked",
        detail: "Traceroute tidak menghasilkan hop",
        sourceRef: "traceroute",
        sampledAt: null,
        checkedAt: "2026-10-25T10:00:00Z",
      },
      {
        id: "f4",
        layer: "billing",
        metric: "billing_status",
        label: "Status billing",
        value: "active",
        threshold: "lunas",
        comparator: "=",
        status: "ok",
        detail: "Tagihan lunas",
        sourceRef: "billing",
        sampledAt: null,
        checkedAt: "2026-10-25T10:00:00Z",
      },
    ],
  };

  const text = runSummaryText(run);

  // Periksa header
  assert.match(text, /Ahmad Dani \(dani@isp\)/);
  assert.match(text, /Otomatis · Alert: sinyal optik ONU/);
  assert.match(text, /2026-10-25T10:00:06Z/);

  // Periksa kesimpulan
  assert.match(text, /Optik OLT\/ONU/);
  assert.match(text, /Gangguan pelanggan sendiri/);
  assert.match(text, /Sinyal optik redam \(-27 dBm\)/);

  // Periksa temuan bermasalah (non-ok)
  assert.match(
    text,
    /\[FAIL\] Optik OLT\/ONU · Rx ONU: nilai=-27 dBm, ambang=-24 s\.d\. -8 dBm/,
  );
  assert.match(
    text,
    /\[WARN\] MikroTik \(PPPoE, queue, interface\) · Paket dibuang antrean/,
  );

  // Periksa temuan tidak dapat diperiksa (unchecked)
  assert.match(
    text,
    /\[UNCHECKED\] Pengukuran aktif & baseline · Traceroute upstream: Traceroute tidak menghasilkan hop/,
  );

  // Memastikan temuan status ok tidak masuk ke daftar bermasalah
  assert.doesNotMatch(text, /\[OK\]/);
  assert.doesNotMatch(text, /Tagihan lunas/);
});
