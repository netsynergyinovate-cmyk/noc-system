import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_PING_LOSS_FAIL,
  ACTIVE_PING_LOSS_WARN,
  ACTIVE_RTT_WARN_MS,
  DNS_PROBE_NAME,
  RATE_BASELINE_MIN_BUCKETS,
  RATE_SATURATION_PCT,
  RATE_UNUSED_PCT,
  TRACE_HOP_LOSS_WARN,
  diagnosticLayers,
  evaluateCustomerPing,
  evaluateDns,
  evaluateRateBaseline,
  evaluateTraceroute,
  layerLabel,
  decideVerdict,
} from "../src/lib/diagnostics.ts";

const now = new Date("2026-10-24T10:00:00Z");
const src = "router-utama";
const emptyEvidence = { router: null, pon: null, windowMinutes: 15 };

test("urutan dan registri lapisan diagnostik mencakup lapisan aktif", () => {
  assert.equal(diagnosticLayers.length, 9);
  const layerIds = diagnosticLayers.map((l) => l.id);
  assert.deepEqual(layerIds, [
    "hulu",
    "mikrotik",
    "log",
    "firewall",
    "optik",
    "ont",
    "trafik",
    "aktif",
    "billing",
  ]);

  const aktif = diagnosticLayers.find((l) => l.id === "aktif");
  assert.ok(aktif);
  assert.equal(aktif.label, "Pengukuran aktif & baseline");
  assert.equal(aktif.phase, 7);
  assert.equal(layerLabel("aktif"), "Pengukuran aktif & baseline");

  // Prioritas verdict: fail di log/trafik mendahului fail di aktif
  const fTrafik = {
    layer: "trafik",
    metric: "traffic_trend",
    label: "Tren trafik",
    value: "turun",
    threshold: null,
    comparator: null,
    status: "fail",
    detail: "Trafik drop",
    sourceRef: src,
    sampledAt: now,
  };
  const fAktif = {
    layer: "aktif",
    metric: "ping_customer",
    label: "Ping ke pelanggan",
    value: "loss 100%",
    threshold: null,
    comparator: null,
    status: "fail",
    detail: "Loss total",
    sourceRef: src,
    sampledAt: now,
  };
  assert.equal(
    decideVerdict([fAktif, fTrafik], emptyEvidence, null, now).layer,
    "trafik",
  );
  assert.equal(
    decideVerdict([fAktif], emptyEvidence, null, now).layer,
    "aktif",
  );

  // Warn di aktif mendahului billing
  const fAktifWarn = {
    ...fAktif,
    status: "warn",
    detail: "Loss sedang",
  };
  const fBillingWarn = {
    layer: "billing",
    metric: "arrears",
    label: "Tunggakan",
    value: "1 bulan",
    threshold: null,
    comparator: null,
    status: "warn",
    detail: "Ada tunggakan",
    sourceRef: src,
    sampledAt: now,
  };
  assert.equal(
    decideVerdict([fBillingWarn, fAktifWarn], emptyEvidence, null, now).layer,
    "aktif",
  );
});

test("ping pelanggan: normal, warn (loss), warn (rtt), fail (loss tinggi), unchecked", () => {
  // ok
  const ok = evaluateCustomerPing(
    "10.10.10.2",
    { sent: 10, received: 10, avgMs: 14.5, maxMs: 25.1, jitterMs: 1.2 },
    src,
    now,
  );
  assert.equal(ok.status, "ok");
  assert.equal(ok.layer, "aktif");
  assert.equal(ok.metric, "ping_customer");
  assert.match(ok.value, /loss 0% \(10\/10\), rata-rata 14\.5 ms/);

  // warn on loss (>= 2%)
  const warnLoss = evaluateCustomerPing(
    "10.10.10.2",
    { sent: 50, received: 48, avgMs: 18.0, maxMs: 30.0, jitterMs: 2.0 },
    src,
    now,
  );
  assert.equal(warnLoss.status, "warn");
  assert.match(warnLoss.detail, /paket loss \(4%/);

  // warn on RTT (>= 80 ms)
  const warnRtt = evaluateCustomerPing(
    "10.10.10.2",
    { sent: 10, received: 10, avgMs: 85.0, maxMs: 110.0, jitterMs: 4.0 },
    src,
    now,
  );
  assert.equal(warnRtt.status, "warn");
  assert.match(warnRtt.detail, /Latensi rata-rata tinggi \(85\.0 ms/);

  // fail on loss (>= 10%)
  const fail = evaluateCustomerPing(
    "10.10.10.2",
    { sent: 10, received: 8, avgMs: 22.0, maxMs: 45.0, jitterMs: 3.5 },
    src,
    now,
  );
  assert.equal(fail.status, "fail");
  assert.match(fail.detail, /Paket loss tinggi \(20% ≥ 10%\)/);

  // unchecked bila address null
  const unAddress = evaluateCustomerPing(
    null,
    { sent: 10, received: 10, avgMs: 10, maxMs: 15, jitterMs: 1 },
    src,
    now,
  );
  assert.equal(unAddress.status, "unchecked");
  assert.match(unAddress.detail, /tidak memiliki alamat IP aktif/);

  // unchecked bila p null
  const unNullP = evaluateCustomerPing("10.10.10.2", null, src, now);
  assert.equal(unNullP.status, "unchecked");
  assert.match(unNullP.detail, /tidak menghasilkan data/);

  // unchecked bila p.sent === 0
  const unZeroSent = evaluateCustomerPing(
    "10.10.10.2",
    { sent: 0, received: 0, avgMs: null, maxMs: null, jitterMs: null },
    src,
    now,
  );
  assert.equal(unZeroSent.status, "unchecked");
});

test("traceroute upstream: normal, lonjakan rtt, loss di hop 3, unchecked", () => {
  const normalHops = [
    { hop: 1, address: "192.168.1.1", lossPct: 0, avgMs: 1.2 },
    { hop: 2, address: "10.0.0.1", lossPct: 0, avgMs: 6.4 },
    { hop: 3, address: "8.8.8.8", lossPct: 0, avgMs: 16.8 },
  ];
  const ok = evaluateTraceroute("8.8.8.8", normalHops, src, now);
  assert.equal(ok.status, "ok");
  assert.equal(ok.layer, "aktif");
  assert.equal(ok.metric, "traceroute_upstream");
  assert.match(ok.value, /3 hop/);
  assert.match(ok.value, /lonjakan RTT terbesar \+10\.4 ms di hop 3/);
  assert.match(ok.detail, /lancar/);

  // Loss di hop 3 (>= 20%)
  const lossHop3 = [
    { hop: 1, address: "192.168.1.1", lossPct: 0, avgMs: 1.2 },
    { hop: 2, address: "10.0.0.1", lossPct: 0, avgMs: 5.5 },
    { hop: 3, address: "202.158.1.1", lossPct: 25, avgMs: 25.0 },
    { hop: 4, address: "8.8.8.8", lossPct: 0, avgMs: 28.0 },
  ];
  const warn = evaluateTraceroute("8.8.8.8", lossHop3, src, now);
  assert.equal(warn.status, "warn");
  assert.match(warn.detail, /hop 3 \(202\.158\.1\.1\): loss 25%/);
  assert.match(warn.value, /loss di hop 3 \(25%\)/);

  // Unchecked bila hop kosong
  const un = evaluateTraceroute("8.8.8.8", [], src, now);
  assert.equal(un.status, "unchecked");
  assert.match(un.detail, /tidak menghasilkan hop/);
});

test("resolusi DNS: terurai ok, kegagalan DNS fail, kegagalan baca unchecked", () => {
  // ok
  const ok = evaluateDns(
    { name: "google.com", resolved: true, ms: 12.4, error: null },
    src,
    now,
  );
  assert.equal(ok.status, "ok");
  assert.equal(ok.layer, "aktif");
  assert.equal(ok.metric, "dns_resolve");
  assert.match(ok.value, /terurai, rtt 12\.4 ms/);
  assert.match(ok.detail, /Router berhasil mengurai/);

  // DNS failure: router reports dns name does not exist
  const fail1 = evaluateDns(
    {
      name: "google.com",
      resolved: false,
      ms: null,
      error: "failure: dns name does not exist",
    },
    src,
    now,
  );
  assert.equal(fail1.status, "fail");
  assert.equal(fail1.value, "gagal terurai");
  assert.match(fail1.detail, /gagal mengurai nama domain/);

  // DNS failure: could not resolve
  const fail2 = evaluateDns(
    {
      name: "google.com",
      resolved: false,
      ms: null,
      error: "could not resolve hostname",
    },
    src,
    now,
  );
  assert.equal(fail2.status, "fail");

  // Read error: unchecked
  const unRead = evaluateDns(
    {
      name: "google.com",
      resolved: false,
      ms: null,
      error: "read error",
    },
    src,
    now,
  );
  assert.equal(unRead.status, "unchecked");
  assert.match(unRead.detail, /Pengukuran DNS dari router tidak terbaca/);

  // Probe null: unchecked
  const unNull = evaluateDns(null, src, now);
  assert.equal(unNull.status, "unchecked");
  assert.match(unNull.detail, /tidak ada data pengukuran/);
});

test("rate baseline: riwayat kurang = unchecked", () => {
  const r = evaluateRateBaseline(
    {
      currentDown: 5.0,
      currentUp: 1.0,
      currentPeakDown: 6.0,
      p95Down: 5.5,
      p95Up: 1.2,
      buckets: 12, // < RATE_BASELINE_MIN_BUCKETS (24)
      limitDown: 10,
      limitUp: 2,
    },
    src,
    now,
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].status, "unchecked");
  assert.match(
    r[0].detail,
    /Riwayat sampel trafik kurang \(12 dari minimum 24/,
  );

  const rNoDown = evaluateRateBaseline(
    {
      currentDown: null,
      currentUp: null,
      currentPeakDown: null,
      p95Down: 5.5,
      p95Up: 1.2,
      buckets: 30,
      limitDown: 10,
      limitUp: 2,
    },
    src,
    now,
  );
  assert.equal(rNoDown.length, 1);
  assert.equal(rNoDown[0].status, "unchecked");
});

test("rate baseline: pelanggan 10 Mbps vs 50 Mbps dengan angka Mbps absolut yang sama menghasilkan status berbeda", () => {
  // Parameter trafik absolut yang sama persis untuk kedua pelanggan:
  // peakDown = 9.5 Mbps, avgDown = 8.0 Mbps, avgUp = 2.0 Mbps, p95Down = 8.5 Mbps
  const trafficData = {
    currentPeakDown: 9.5,
    currentDown: 8.0,
    currentUp: 2.0,
    p95Down: 8.5,
    p95Up: 2.0,
    buckets: 30,
  };

  // Pelanggan A (Paket 10 Mbps):
  // Puncak 9.5 Mbps adalah 95% dari limit (>= 90% RATE_SATURATION_PCT) -> jenuh (warn).
  // p95 8.5 Mbps adalah 85% dari limit (>= 30% RATE_UNUSED_PCT) -> tidak unused.
  const res10 = evaluateRateBaseline(
    {
      ...trafficData,
      limitDown: 10,
      limitUp: 5,
    },
    src,
    now,
  );
  assert.equal(res10.length, 1);
  assert.equal(res10[0].metric, "rate_baseline");
  assert.equal(res10[0].status, "warn");
  assert.match(
    res10[0].detail,
    /mencapai 95% dari kapasitas paket \(10 Mbps\)/,
  );

  // Pelanggan B (Paket 50 Mbps):
  // Puncak 9.5 Mbps hanya 19% dari limit (< 90% RATE_SATURATION_PCT) -> normal (ok).
  // Namun p95 8.5 Mbps hanya 17% dari limit (< 30% RATE_UNUSED_PCT) -> paket tidak terpakai/terhambat (warn).
  const res50 = evaluateRateBaseline(
    {
      ...trafficData,
      limitDown: 50,
      limitUp: 25,
    },
    src,
    now,
  );
  assert.equal(res50.length, 2);
  assert.equal(res50[0].metric, "rate_baseline");
  assert.equal(res50[0].status, "ok"); // Tidak jenuh
  assert.match(
    res50[0].detail,
    /berada di bawah batas paket \(19% dari 50 Mbps\)/,
  );

  assert.equal(res50[1].metric, "rate_unused");
  assert.equal(res50[1].status, "warn"); // Paket terhambat/tidak terpakai
  assert.match(res50[1].detail, /hanya 17% dari kapasitas paket \(50 Mbps\)/);

  // Memastikan status baseline berbeda untuk angka trafik yang sama
  assert.notEqual(res10[0].status, res50[0].status);
});

test("rate baseline: paket normal tanpa kejenuhan dan tanpa unused", () => {
  const res = evaluateRateBaseline(
    {
      currentPeakDown: 12.0,
      currentDown: 10.0,
      currentUp: 2.0,
      p95Down: 14.0,
      p95Up: 3.0,
      buckets: 28,
      limitDown: 20,
      limitUp: 10,
    },
    src,
    now,
  );
  assert.equal(res.length, 1);
  assert.equal(res[0].status, "ok");
  assert.match(res[0].value, /60% dari paket 20 Mbps/);
});

test("rate baseline: kejenuhan unggah memicu status warn", () => {
  const res = evaluateRateBaseline(
    {
      currentPeakDown: 10.0,
      currentDown: 8.0,
      currentUp: 4.8, // 96% dari limitUp 5 Mbps
      p95Down: 15.0,
      p95Up: 4.5,
      buckets: 30,
      limitDown: 50,
      limitUp: 5,
    },
    src,
    now,
  );
  assert.equal(res[0].metric, "rate_baseline");
  assert.equal(res[0].status, "warn");
  assert.match(res[0].detail, /Unggahan \(4\.8 Mbps\) mencapai 96%/);
});
