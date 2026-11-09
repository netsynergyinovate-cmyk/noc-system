import test from "node:test";
import assert from "node:assert/strict";
import {
  decideVerdict,
  SHARED_MIN_AFFECTED,
  SHARED_MIN_RATIO,
  SHARED_PON_RATIO,
  VERDICT_HOLD_MS,
  pendingLayer,
  diagnosticLayers,
} from "../src/lib/diagnostics.ts";

const now = new Date("2026-10-24T10:00:00Z");

function makeFinding({
  layer,
  metric = `m_${layer}`,
  label = `Label ${layer}`,
  value = null,
  threshold = null,
  comparator = null,
  status = "ok",
  detail = `Detail ${layer}`,
  sourceRef = "src",
  sampledAt = now,
}) {
  return {
    layer,
    metric,
    label,
    value,
    threshold,
    comparator,
    status,
    detail,
    sourceRef,
    sampledAt,
  };
}

const baseEvidence = {
  router: { name: "R-Core", affected: 0, served: 100 },
  pon: null,
  windowMinutes: 15,
};

const noEvidence = {
  router: null,
  pon: null,
  windowMinutes: 15,
};

test("Konstanta batas sesuai spesifikasi PRD Fase 8", () => {
  assert.equal(SHARED_MIN_AFFECTED, 3);
  assert.equal(SHARED_MIN_RATIO, 0.2);
  assert.equal(SHARED_PON_RATIO, 0.3);
  assert.equal(VERDICT_HOLD_MS, 15 * 60_000);
});

test("Cakupan gangguan: own vs shared vs unknown", () => {
  const fFail = makeFinding({
    layer: "mikrotik",
    status: "fail",
    label: "PPPoE putus",
    detail: "Sesi offline",
  });

  // 1. Own: bukti router tersedia, di bawah ambang gangguan bersama
  const vOwn = decideVerdict([fFail], baseEvidence, null, now);
  assert.equal(vOwn.scope, "own");
  assert.equal(vOwn.layer, "mikrotik");
  assert.deepEqual(vOwn.root, {
    kind: "customer",
    name: "",
    affected: 1,
    served: 1,
  });
  assert.equal(vOwn.held, false);
  assert.match(vOwn.detail, /^Bermasalah di MikroTik/);

  // 2. Unknown: bukti router null (tidak ada data pembanding)
  const vUnknown = decideVerdict([fFail], noEvidence, null, now);
  assert.equal(vUnknown.scope, "unknown");
  assert.equal(vUnknown.layer, "mikrotik");
  assert.equal(vUnknown.root, null);
  assert.match(vUnknown.detail, /^Cakupan gangguan tidak diketahui/);

  // 3. Shared: router di atas ambang batas (affected >= 3 dan ratio >= 0.2)
  const sharedEvidence = {
    router: { name: "R-Core", affected: 5, served: 20 },
    pon: null,
    windowMinutes: 15,
  };
  const vShared = decideVerdict([fFail], sharedEvidence, null, now);
  assert.equal(vShared.scope, "shared");
  assert.equal(vShared.layer, "mikrotik");
  assert.deepEqual(vShared.root, {
    kind: "router",
    name: "R-Core",
    affected: 5,
    served: 20,
  });
  assert.match(
    vShared.detail,
    /^Gangguan bersama: 5 dari 20 pelanggan di router R-Core terdampak; temuan lokal kemungkinan akibat gangguan bersama\./,
  );
});

test("Batas ambang bukti (evidence thresholds at boundary)", () => {
  const f = makeFinding({ layer: "ont", status: "fail", label: "ONT mati" });

  // Boundary affected: 2 vs 3 (rasio 2/10 = 0.2 cukup, tapi affected 2 < 3)
  const ev2Aff = {
    router: { name: "R1", affected: 2, served: 10 },
    pon: null,
    windowMinutes: 15,
  };
  assert.equal(decideVerdict([f], ev2Aff, null, now).scope, "own");

  // Boundary ratio router: 0.19 vs 0.2 (affected 3, served 16 -> 3/16 = 0.1875 < 0.2)
  const evRatioBelow = {
    router: { name: "R1", affected: 3, served: 16 },
    pon: null,
    windowMinutes: 15,
  };
  assert.equal(decideVerdict([f], evRatioBelow, null, now).scope, "own");

  // Boundary ratio router pas 0.2: affected 3, served 15 (3/15 = 0.2)
  const evRatioMatch = {
    router: { name: "R1", affected: 3, served: 15 },
    pon: null,
    windowMinutes: 15,
  };
  const vRouterMatch = decideVerdict([f], evRatioMatch, null, now);
  assert.equal(vRouterMatch.scope, "shared");
  assert.equal(vRouterMatch.root?.kind, "router");

  // Boundary PON: affected 3, served 11 (3/11 = 0.2727 < 0.3)
  const evPonBelow = {
    router: { name: "R1", affected: 0, served: 100 },
    pon: { name: "PON-1/1/1", affected: 3, served: 11 },
    windowMinutes: 15,
  };
  assert.equal(decideVerdict([f], evPonBelow, null, now).scope, "own");

  // Boundary PON pas 0.3: affected 3, served 10 (3/10 = 0.3)
  const evPonMatch = {
    router: { name: "R1", affected: 0, served: 100 },
    pon: { name: "PON-1/1/1", affected: 3, served: 10 },
    windowMinutes: 15,
  };
  const vPonMatch = decideVerdict([f], evPonMatch, null, now);
  assert.equal(vPonMatch.scope, "shared");
  assert.equal(vPonMatch.root?.kind, "odp");
  assert.equal(vPonMatch.root?.name, "PON-1/1/1");
  assert.match(
    vPonMatch.detail,
    /^Gangguan bersama: 3 dari 10 pelanggan di PON PON-1\/1\/1 terdampak/,
  );
});

test("Hulu non-ok => shared + secondary berisi temuan lainnya", () => {
  const fHulu = makeFinding({
    layer: "hulu",
    status: "fail",
    label: "Uplink saturasi",
    value: "99%",
    threshold: "95%",
    comparator: ">=",
    detail: "Trafik penuh",
  });
  const fOptik = makeFinding({
    layer: "optik",
    status: "warn",
    label: "Redaman tinggi",
  });
  const fMikrotik = makeFinding({
    layer: "mikrotik",
    status: "warn",
    label: "Queue drop",
  });

  // Bahkan dengan router.affected = 0, hulu tetap shared
  const v = decideVerdict([fHulu, fOptik, fMikrotik], baseEvidence, null, now);
  assert.equal(v.layer, "hulu");
  assert.equal(v.scope, "shared");
  assert.equal(v.root?.kind, "uplink");
  assert.equal(v.secondary.length, 2);
  assert.equal(v.secondary[0].layer, "optik");
  assert.equal(v.secondary[1].layer, "mikrotik");
  assert.match(v.detail, /^Gangguan bersama: Bermasalah di Hulu/);
  assert.match(v.detail, /Temuan terkait: optik, mikrotik\./);
});

test("Optik LOS menekan temuan mikrotik dan aktif ke secondary ('akibat')", () => {
  const fOptik = makeFinding({
    layer: "optik",
    status: "fail",
    label: "LOS",
    detail: "Kabel putus",
  });
  const fMikrotik = makeFinding({
    layer: "mikrotik",
    status: "fail",
    label: "PPPoE putus",
    detail: "Sesi mati",
  });
  const fAktif = makeFinding({
    layer: "aktif",
    status: "warn",
    label: "Ping pelanggan loss",
    detail: "Loss 100%",
  });

  const v = decideVerdict([fMikrotik, fOptik, fAktif], baseEvidence, null, now);
  assert.equal(v.layer, "optik");
  assert.equal(v.secondary.length, 2);
  // mikrotik (fail, rank 4) mendahului aktif (warn, rank 8)
  assert.equal(v.secondary[0].layer, "mikrotik");
  assert.equal(v.secondary[1].layer, "aktif");
  assert.match(v.detail, /Temuan terkait: mikrotik, aktif\./);
});

test("Billing fail => own dengan temuan lain sebagai secondary", () => {
  const fBilling = makeFinding({
    layer: "billing",
    status: "fail",
    label: "Isolir",
    detail: "Tagihan menunggak",
  });
  const fOptik = makeFinding({
    layer: "optik",
    status: "fail",
    label: "Redaman jelek",
  });
  const fMikrotik = makeFinding({
    layer: "mikrotik",
    status: "fail",
    label: "PPPoE drop",
  });

  // Sekalipun router evidence menunjukkan gangguan massal, isolir billing adalah fakta per-pelanggan
  const sharedEvidence = {
    router: { name: "R-Core", affected: 10, served: 20 },
    pon: null,
    windowMinutes: 15,
  };
  const v = decideVerdict(
    [fBilling, fOptik, fMikrotik],
    sharedEvidence,
    null,
    now,
  );
  assert.equal(v.layer, "billing");
  assert.equal(v.scope, "own");
  assert.deepEqual(v.root, {
    kind: "customer",
    name: "",
    affected: 1,
    served: 1,
  });
  assert.equal(v.secondary.length, 2);
  assert.equal(v.secondary[0].layer, "optik");
  assert.equal(v.secondary[1].layer, "mikrotik");
});

test("Billing warn diperiksa paling akhir (setelah aktif)", () => {
  const fBillingWarn = makeFinding({
    layer: "billing",
    status: "warn",
    label: "Tunggakan berjalan",
  });
  const fAktifWarn = makeFinding({
    layer: "aktif",
    status: "warn",
    label: "Ping RTT tinggi",
  });

  const v = decideVerdict([fBillingWarn, fAktifWarn], baseEvidence, null, now);
  assert.equal(v.layer, "aktif");
  assert.equal(v.secondary.length, 1);
  assert.equal(v.secondary[0].layer, "billing");
});

test("Fail selalu mengalahkan warn (fail beats warn)", () => {
  // Aktif fail (loss total) vs optik warn (sinyal agak lemah)
  const fAktifFail = makeFinding({
    layer: "aktif",
    status: "fail",
    label: "Loss 100%",
  });
  const fOptikWarn = makeFinding({
    layer: "optik",
    status: "warn",
    label: "Rx -25 dBm",
  });

  const v = decideVerdict([fOptikWarn, fAktifFail], baseEvidence, null, now);
  assert.equal(v.layer, "aktif");
  assert.equal(v.secondary[0].layer, "optik");
});

test("Anti-flapping: kesimpulan dipertahankan jika dalam 15 menit dan masih bermasalah", () => {
  const t0 = new Date("2026-10-24T10:00:00Z");
  const tPrev10Min = new Date("2026-10-24T09:50:00Z"); // 10 menit lalu (< 15 menit)
  const tPrev20Min = new Date("2026-10-24T09:40:00Z"); // 20 menit lalu (> 15 menit)

  const fMikrotikWarn = makeFinding({
    layer: "mikrotik",
    status: "warn",
    label: "Queue limit",
  });
  const fOptikWarn = makeFinding({
    layer: "optik",
    status: "warn",
    label: "Rx agak lemah",
  });

  // Tanpa previous: optik menang atas mikrotik
  const vNoPrev = decideVerdict(
    [fMikrotikWarn, fOptikWarn],
    baseEvidence,
    null,
    t0,
  );
  assert.equal(vNoPrev.layer, "optik");
  assert.equal(vNoPrev.held, false);

  // Dengan previous = mikrotik dalam 10 menit: mikrotik dipertahankan
  const vHeld = decideVerdict(
    [fMikrotikWarn, fOptikWarn],
    baseEvidence,
    { layer: "mikrotik", finishedAt: tPrev10Min },
    t0,
  );
  assert.equal(vHeld.layer, "mikrotik");
  assert.equal(vHeld.held, true);
  assert.equal(vHeld.secondary[0].layer, "optik");
  assert.match(
    vHeld.detail,
    /Kesimpulan dipertahankan dari diagnosa sebelumnya \(anti-flapping\)\.$/,
  );

  // Dengan previous = mikrotik lebih dari 15 menit: tidak dipertahankan
  const vExpired = decideVerdict(
    [fMikrotikWarn, fOptikWarn],
    baseEvidence,
    { layer: "mikrotik", finishedAt: tPrev20Min },
    t0,
  );
  assert.equal(vExpired.layer, "optik");
  assert.equal(vExpired.held, false);
});

test("Anti-flapping: fail baru mengalahkan kesimpulan lama yang hanya warn", () => {
  const t0 = new Date("2026-10-24T10:00:00Z");
  const tPrev5Min = new Date("2026-10-24T09:55:00Z");

  const fMikrotikWarn = makeFinding({
    layer: "mikrotik",
    status: "warn",
    label: "Queue warning",
  });
  const fOptikFail = makeFinding({
    layer: "optik",
    status: "fail",
    label: "Optik LOS",
  });

  // Previous mikrotik (hanya warn), tapi kandidat optik adalah fail -> optik menang, tidak di-hold
  const v = decideVerdict(
    [fMikrotikWarn, fOptikFail],
    baseEvidence,
    { layer: "mikrotik", finishedAt: tPrev5Min },
    t0,
  );
  assert.equal(v.layer, "optik");
  assert.equal(v.held, false);
});

test("Independensi urutan masukan (order-independence via shuffle)", () => {
  const findings = [
    makeFinding({ layer: "billing", status: "warn", label: "Bill Warn" }),
    makeFinding({
      layer: "mikrotik",
      status: "fail",
      label: "PPPoE Drop",
      metric: "pppoe",
    }),
    makeFinding({
      layer: "optik",
      status: "fail",
      label: "Optik LOS",
      metric: "onu_rx",
    }),
    makeFinding({ layer: "aktif", status: "warn", label: "Ping RTT" }),
    makeFinding({ layer: "log", status: "ok", label: "Log Normal" }),
    makeFinding({ layer: "firewall", status: "ok", label: "FW Normal" }),
  ];

  const canonical = decideVerdict(findings, baseEvidence, null, now);

  // Acak urutan berkali-kali
  for (let seed = 1; seed <= 5; seed++) {
    const shuffled = [...findings].sort(() => (seed % 2 === 0 ? 1 : -1));
    const result = decideVerdict(shuffled, baseEvidence, null, now);
    assert.deepEqual(result, canonical);
  }
});

test("Angka dan ambang tampil jelas pada detail", () => {
  const f = makeFinding({
    layer: "optik",
    status: "fail",
    label: "Redaman buruk",
    value: "-29.5 dBm",
    comparator: "<",
    threshold: "-27 dBm",
    detail: "Sinyal di bawah batas normal.",
  });

  const v = decideVerdict([f], baseEvidence, null, now);
  assert.match(v.detail, /-29\.5 dBm/);
  assert.match(v.detail, /\(ambang < -27 dBm\)/);
  assert.match(v.detail, /Sinyal di bawah batas normal\./);
});

test("Kasus tanpa bukti router menghasilkan cakupan unknown", () => {
  const f = makeFinding({
    layer: "ont",
    status: "fail",
    label: "ONT down",
    detail: "Tidak merespons TR-069",
  });

  const v = decideVerdict([f], noEvidence, null, now);
  assert.equal(v.scope, "unknown");
  assert.equal(v.root, null);
  assert.match(
    v.detail,
    /^Cakupan gangguan tidak diketahui \(bukti router tidak tersedia\): Bermasalah di ONT/,
  );
});

test("Kasus semua lapisan normal atau tidak dapat diperiksa", () => {
  // 1. Semua unchecked
  const uncheckedAll = diagnosticLayers.map((l) => pendingLayer(l.id, l.label));
  const vUnchecked = decideVerdict(uncheckedAll, noEvidence, null, now);
  assert.equal(vUnchecked.layer, null);
  assert.equal(vUnchecked.scope, "unknown");
  assert.equal(vUnchecked.root, null);
  assert.equal(vUnchecked.held, false);
  assert.equal(
    vUnchecked.detail,
    "Tidak ada lapisan yang dapat diperiksa; belum ada kesimpulan.",
  );

  // 2. Sebagian ok, sebagian unchecked
  const okOptik = makeFinding({ layer: "optik", status: "ok" });
  const pendingHulu = pendingLayer("hulu", "Hulu");
  const vPartial = decideVerdict(
    [okOptik, pendingHulu],
    baseEvidence,
    null,
    now,
  );
  assert.equal(vPartial.layer, null);
  assert.equal(vPartial.scope, "own");
  assert.match(vPartial.detail, /belum lengkap/);

  // 3. Semua 9 lapisan normal
  const allOk = diagnosticLayers.map((l) =>
    makeFinding({ layer: l.id, status: "ok" }),
  );
  const vAllOk = decideVerdict(allOk, baseEvidence, null, now);
  assert.equal(vAllOk.layer, null);
  assert.equal(vAllOk.scope, "own");
  assert.equal(vAllOk.detail, "Semua lapisan normal.");
});
