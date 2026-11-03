import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOutages,
  buildCustomerEvidence,
} from "../src/lib/customer-evidence.ts";
import { buildIncidents } from "../src/lib/customer-incidents.ts";
import {
  INCIDENT_MERGE_GAP_SECONDS,
  INCIDENT_MIN_DOWN_SECONDS,
  INCIDENT_MIN_FLAPS,
  INCIDENT_BUCKET_SECONDS,
  INCIDENT_BUCKET_TOLERANCE_SAMPLES,
  INCIDENT_EDGE_SECONDS,
  INCIDENT_SETTLE_SECONDS,
  MASS_MIN_CUSTOMERS,
  MASS_MIN_SHARE,
} from "../src/lib/customer-evidence-types.ts";

const BASE_TIME = 1700000100; // kelipatan 300
const FROM_24H = BASE_TIME - 24 * 3600;

function makeBucket(bucketStart, samples = 300, downAvg = 15, upAvg = 2) {
  return {
    bucketStart,
    samples,
    downAvg,
    upAvg,
    downMax: downAvg * 1.5,
    upMax: upAvg * 1.5,
  };
}

test("flap storm of 30 outages inside 15-min gaps -> ONE incident counted once", () => {
  const nowSec = BASE_TIME;
  const from = FROM_24H;
  const to = nowSec;

  // 30 kali putus, masing-masing 30 detik down dan 60 detik up (jeda 60 detik <= 15 menit)
  // Total durasi kluster = 30 * 90 = 2700 detik = 45 menit
  // Berakhir 15 menit lalu (settled > 10 menit => final = true)
  const clusterStart = nowSec - 3600;
  const rawOutages = [];
  let t = clusterStart;
  for (let i = 0; i < 30; i++) {
    rawOutages.push({
      realStart: t,
      realEnd: t + 30,
      from: t,
      to: t + 30,
      seconds: 30,
      source: "live",
      windows: [],
    });
    t += 90;
  }
  const clusterEnd = t - 60; // akhir putus ke-30

  // Sediakan sampel sebelum mulai dan sesudah akhir
  const buckets = [
    makeBucket(clusterStart - 300, 300),
    makeBucket(clusterStart - 600, 300),
    makeBucket(clusterEnd + 300, 300),
  ];

  const { incidents, summary } = buildIncidents({
    nowSec,
    from,
    to,
    outages: rawOutages,
    buckets,
  });

  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].outageCount, 30);
  assert.equal(incidents[0].downSeconds, 30 * 30); // 900 detik >= 300 detik
  assert.equal(incidents[0].final, true);
  assert.equal(incidents[0].verdict, "terbukti");
  assert.equal(summary.real, 1);
  assert.equal(summary.kedipan, 0);
});

test("isolated 2-min outage -> kedipan not counted", () => {
  const nowSec = BASE_TIME;
  const from = FROM_24H;
  const to = nowSec;

  // 1 putus berdurasi 120 detik (2 menit), selesai 1 jam lalu (final = true)
  const outageStart = nowSec - 3600;
  const outageEnd = outageStart + 120;
  const rawOutages = [
    {
      realStart: outageStart,
      realEnd: outageEnd,
      from: outageStart,
      to: outageEnd,
      seconds: 120,
      source: "live",
      windows: [],
    },
  ];

  const buckets = [
    makeBucket(outageStart - 300, 300),
    makeBucket(outageEnd + 300, 300),
  ];

  const { incidents, summary } = buildIncidents({
    nowSec,
    from,
    to,
    outages: rawOutages,
    buckets,
  });

  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].verdict, "kedipan");
  assert.ok(incidents[0].verdictReason.includes("kedipan"));
  assert.ok(incidents[0].verdictReason.includes("2 menit"));
  assert.equal(summary.real, 0);
  assert.equal(summary.kedipan, 1);
});

test("3 flaps of 1 min within gaps -> counted (instability) when traffic confirms", () => {
  const nowSec = BASE_TIME;
  const from = FROM_24H;
  const to = nowSec;

  // 3 putus berdurasi 60 detik (total 180s < 300s, tapi outageCount = 3 >= 3)
  const start = nowSec - 3600;
  const rawOutages = [
    {
      realStart: start,
      realEnd: start + 60,
      from: start,
      to: start + 60,
      seconds: 60,
      source: "live",
      windows: [],
    },
    {
      realStart: start + 120,
      realEnd: start + 180,
      from: start + 120,
      to: start + 180,
      seconds: 60,
      source: "live",
      windows: [],
    },
    {
      realStart: start + 240,
      realEnd: start + 300,
      from: start + 240,
      to: start + 300,
      seconds: 60,
      source: "live",
      windows: [],
    },
  ];

  const buckets = [
    makeBucket(start - 300, 300),
    makeBucket(start + 600, 300),
  ];

  const { incidents, summary } = buildIncidents({
    nowSec,
    from,
    to,
    outages: rawOutages,
    buckets,
  });

  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].outageCount, 3);
  assert.equal(incidents[0].downSeconds, 180);
  assert.equal(incidents[0].verdict, "terbukti");
  assert.equal(incidents[0].final, true);
  assert.equal(summary.real, 1);
  assert.equal(summary.kedipan, 0);
});

test("traffic contradiction (bucket with 290 samples inside a 10-min down) -> tidak-terbukti and not counted", () => {
  const nowSec = BASE_TIME;
  const from = FROM_24H;
  const to = nowSec;

  // Putus 10 menit (600 detik) persis di kelipatan bucket 300 detik
  const start = nowSec - 3600; // misal 10:00
  const end = start + 600; // misal 10:10
  const rawOutages = [
    {
      realStart: start,
      realEnd: end,
      from: start,
      to: end,
      seconds: 600,
      source: "live",
      windows: [],
    },
  ];

  // Bucket [start, start + 300] seharusnya down 300 detik (maks allowed = (300-300)+60 = 60)
  // Tetapi berisi 290 sampel!
  const buckets = [
    makeBucket(start - 300, 300),
    makeBucket(start, 290), // KONTRADIKSI
    makeBucket(end + 300, 300),
  ];

  const { incidents, summary } = buildIncidents({
    nowSec,
    from,
    to,
    outages: rawOutages,
    buckets,
  });

  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].verdict, "tidak-terbukti");
  assert.ok(incidents[0].verdictReason.includes("Trafik tetap mengalir"));
  assert.ok(incidents[0].verdictReason.includes("290"));
  assert.ok(incidents[0].verdictReason.includes("batas 60"));
  assert.equal(summary.real, 0);
  assert.equal(summary.tidakTerbukti, 1);
});

test("alert-sourced outage gets the wider tolerance: 200 samples in a fully-down bucket is allowed, live is refuted", () => {
  const nowSec = BASE_TIME;
  const start = nowSec - 3600;
  const end = start + 600;
  const run = (source) =>
    buildIncidents({
      nowSec,
      from: FROM_24H,
      to: nowSec,
      outages: [{ realStart: start, realEnd: end, from: start, to: end, seconds: 600, source, windows: [] }],
      buckets: [makeBucket(start - 300, 300), makeBucket(start, 150), makeBucket(end + 300, 300)],
    }).incidents[0];
  assert.equal(run("alert").verdict, "terbukti"); // 150 <= 0 + 180
  assert.equal(run("live").verdict, "tidak-terbukti"); // 150 > 0 + 60
});

test("no traffic before start -> belum-terverifikasi", () => {
  const nowSec = BASE_TIME;
  const from = FROM_24H;
  const to = nowSec;

  const start = nowSec - 3600;
  const end = start + 600;
  const rawOutages = [
    {
      realStart: start,
      realEnd: end,
      from: start,
      to: end,
      seconds: 600,
      source: "live",
      windows: [],
    },
  ];

  // Sampel hanya ada setelah selesai, tidak ada sebelum mulai
  const buckets = [
    makeBucket(end + 300, 300),
  ];

  const { incidents, summary } = buildIncidents({
    nowSec,
    from,
    to,
    outages: rawOutages,
    buckets,
  });

  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].verdict, "belum-terverifikasi");
  assert.ok(incidents[0].verdictReason.includes("Belum ada data trafik tepat sebelum gangguan"));
  assert.equal(summary.real, 0);
  assert.equal(summary.belumTerverifikasi, 1);
});

test("ongoing incident -> not counted, final=false", () => {
  const nowSec = BASE_TIME;
  const from = FROM_24H;
  const to = nowSec;

  const start = nowSec - 600;
  const rawOutages = [
    {
      realStart: start,
      realEnd: null,
      from: start,
      to: null, // Masih terbuka
      seconds: 600,
      source: "live",
      windows: [],
    },
  ];

  const buckets = [makeBucket(start - 300, 300)];

  const { incidents, summary } = buildIncidents({
    nowSec,
    from,
    to,
    outages: rawOutages,
    buckets,
  });

  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].final, false);
  assert.equal(incidents[0].verdict, "belum-terverifikasi");
  assert.ok(incidents[0].verdictReason.includes("Belum final: gangguan masih berlangsung"));
  assert.equal(summary.real, 0);
  assert.equal(summary.belumTerverifikasi, 1);
});

test("ended 5 min ago -> not final", () => {
  const nowSec = BASE_TIME;
  const from = FROM_24H;
  const to = nowSec;

  // Selesai 5 menit (300 detik) lalu (< INCIDENT_SETTLE_SECONDS 600s)
  const end = nowSec - 300;
  const start = end - 600;
  const rawOutages = [
    {
      realStart: start,
      realEnd: end,
      from: start,
      to: end,
      seconds: 600,
      source: "live",
      windows: [],
    },
  ];

  const buckets = [
    makeBucket(start - 300, 300),
    makeBucket(end + 60, 300),
  ];

  const { incidents, summary } = buildIncidents({
    nowSec,
    from,
    to,
    outages: rawOutages,
    buckets,
  });

  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].final, false);
  assert.equal(incidents[0].verdict, "belum-terverifikasi");
  assert.ok(incidents[0].verdictReason.includes("Belum final: gangguan baru selesai kurang dari 10 menit lalu"));
  assert.equal(summary.real, 0);
  assert.equal(summary.belumTerverifikasi, 1);
});

test("verification at bucket boundaries/partial overlap exact math", () => {
  const nowSec = BASE_TIME;
  const from = FROM_24H;
  const to = nowSec;

  // Ambil satu bucket tepat [B, B + 300]
  const B = nowSec - 3600;
  // Gangguan dari B + 100 sampai B + 250 (150 detik down dalam bucket ini)
  // Detik up dalam bucket = 300 - 150 = 150 detik
  // Maksimal sampel diizinkan = 150 + 60 = 210 sampel
  const outageStart = B + 100;
  const outageEnd = B + 250;
  const rawOutages = [
    {
      realStart: outageStart,
      realEnd: outageEnd,
      from: outageStart,
      to: outageEnd,
      seconds: 150,
      source: "live",
      windows: [],
    },
    // Tambah putus lain agar total down >= 300 detik sehingga bukan kedipan
    {
      realStart: B + 350,
      realEnd: B + 550,
      from: B + 350,
      to: B + 550,
      seconds: 200,
      source: "live",
      windows: [],
    },
  ];

  // Kasus 1: Tepat 210 sampel di bucket B -> OK (<= 210)
  const bucketsOk = [
    makeBucket(outageStart - 300, 300),
    makeBucket(B, 210), // Pas batas
    makeBucket(B + 900, 300),
  ];

  const resOk = buildIncidents({
    nowSec,
    from,
    to,
    outages: rawOutages,
    buckets: bucketsOk,
  });
  assert.equal(resOk.incidents[0].verdict, "terbukti");

  // Kasus 2: 211 sampel di bucket B -> Melebihi batas (211 > 210) -> tidak-terbukti!
  const bucketsExceeded = [
    makeBucket(outageStart - 300, 300),
    makeBucket(B, 211), // Melebihi batas toleransi
    makeBucket(B + 900, 300),
  ];

  const resExceeded = buildIncidents({
    nowSec,
    from,
    to,
    outages: rawOutages,
    buckets: bucketsExceeded,
  });
  assert.equal(resExceeded.incidents[0].verdict, "tidak-terbukti");
  assert.ok(resExceeded.incidents[0].verdictReason.includes("211"));
  assert.ok(resExceeded.incidents[0].verdictReason.includes("batas 210"));
});

test("massal vs sendiri thresholds", () => {
  const nowSec = BASE_TIME;
  const from = FROM_24H;
  const to = nowSec;

  const start = nowSec - 3600;
  const end = start + 600;
  const rawOutages = [
    {
      realStart: start,
      realEnd: end,
      from: start,
      to: end,
      seconds: 600,
      source: "live",
      windows: [],
    },
  ];
  const buckets = [
    makeBucket(start - 300, 300),
    makeBucket(end + 300, 300),
  ];

  // Kasus A: router 10 pelanggan, 3 pelanggan lain down bersamaan (3 >= 3 dan 3/10 = 0.3 >= 0.2) -> massal
  const scopeMassal = {
    routerCustomers: 10,
    others: [
      [{ from: start + 50, to: end - 50 }],
      [{ from: start, to: end }],
      [{ from: start - 100, to: start + 200 }],
    ],
  };
  const resMassal = buildIncidents({
    nowSec,
    from,
    to,
    outages: rawOutages,
    buckets,
    scope: scopeMassal,
  });
  assert.equal(resMassal.incidents[0].scope.kind, "massal");
  assert.equal(resMassal.incidents[0].scope.otherDown, 3);
  assert.equal(resMassal.summary.realMassal, 1);

  // Kasus B: router 10 pelanggan, hanya 2 pelanggan lain down (< 3) -> sendiri
  const scopeKurangPelanggan = {
    routerCustomers: 10,
    others: [
      [{ from: start, to: end }],
      [{ from: start, to: end }],
    ],
  };
  const resKurang = buildIncidents({
    nowSec,
    from,
    to,
    outages: rawOutages,
    buckets,
    scope: scopeKurangPelanggan,
  });
  assert.equal(resKurang.incidents[0].scope.kind, "sendiri");
  assert.equal(resKurang.summary.realMassal, 0);

  // Kasus C: router 20 pelanggan, 3 pelanggan lain down (3 >= 3 tapi 3/20 = 0.15 < 0.2) -> sendiri
  const scopeKurangShare = {
    routerCustomers: 20,
    others: [
      [{ from: start, to: end }],
      [{ from: start, to: end }],
      [{ from: start, to: end }],
    ],
  };
  const resKurangShare = buildIncidents({
    nowSec,
    from,
    to,
    outages: rawOutages,
    buckets,
    scope: scopeKurangShare,
  });
  assert.equal(resKurangShare.incidents[0].scope.kind, "sendiri");
  assert.equal(resKurangShare.summary.realMassal, 0);

  // Kasus D: routerCustomers null -> tidak-diketahui
  const scopeUnknown = {
    routerCustomers: null,
    others: [],
  };
  const resUnknown = buildIncidents({
    nowSec,
    from,
    to,
    outages: rawOutages,
    buckets,
    scope: scopeUnknown,
  });
  assert.equal(resUnknown.incidents[0].scope.kind, "tidak-diketahui");
});

test("range filter (incident starting before from excluded)", () => {
  const nowSec = BASE_TIME;
  const from = FROM_24H;
  const to = nowSec;

  const rawOutages = [
    // Outage 1: Mulai sebelum 'from', selesai setelah 'from' -> first outage realStart < from, to !== null => Dieliminasi dari rentang ini
    {
      realStart: from - 7200,
      realEnd: from + 300,
      from: from,
      to: from + 300,
      seconds: 300,
      source: "live",
      windows: [],
    },
    // Outage 2: Mulai di dalam rentang waktu [from, to] -> Dimasukkan
    {
      realStart: from + 3600,
      realEnd: from + 4200,
      from: from + 3600,
      to: from + 4200,
      seconds: 600,
      source: "live",
      windows: [],
    },
    // Outage 3: Mulai sebelum 'from', tapi masih terbuka (to === null) -> Dimasukkan karena masih berlangsung
    // (diuji terpisah jika berdiri sendiri)
  ];

  const buckets = [
    makeBucket(from + 3300, 300),
    makeBucket(from + 4500, 300),
  ];

  const { incidents } = buildIncidents({
    nowSec,
    from,
    to,
    outages: rawOutages,
    buckets,
  });

  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].from, from + 3600);
});

test("same-fixture list/detail parity", () => {
  const nowSec = BASE_TIME;
  const from = FROM_24H;
  const to = nowSec;

  const events = [
    { at: from + 1000, kind: "down", source: "live" },
    { at: from + 1600, kind: "up", source: "live" },
  ];
  const priorEvent = { at: from - 5000, kind: "up", source: "live" };

  const buckets = [
    makeBucket(from + 600, 300),
    makeBucket(from + 1800, 300),
  ];

  const scope = {
    routerCustomers: 5,
    others: [],
  };

  // 1. Logika detail endpoint (buildCustomerEvidence)
  const evidence = buildCustomerEvidence({
    range: "24h",
    nowSec,
    events,
    priorEvent,
    buckets,
    scope,
  });

  // 2. Logika list endpoint (buildOutages + buildIncidents)
  const outages = buildOutages(events, priorEvent, from, to, nowSec);
  const listResult = buildIncidents({
    nowSec,
    from,
    to,
    outages,
    buckets,
    scope,
  });

  // Verifikasi kesamaan angka antara detail dan list
  assert.equal(evidence.incidentSummary.real, listResult.summary.real);
  assert.equal(
    evidence.incidentSummary.realDownSeconds,
    listResult.summary.realDownSeconds,
  );
  assert.equal(
    evidence.incidentSummary.belumTerverifikasi,
    listResult.summary.belumTerverifikasi,
  );
  assert.equal(
    evidence.incidentSummary.tidakTerbukti,
    listResult.summary.tidakTerbukti,
  );
  assert.equal(evidence.incidentSummary.kedipan, listResult.summary.kedipan);
  assert.deepEqual(evidence.incidents, listResult.incidents);
});

test("regression: incident starting within 5 min after 'from' has edge bucket before 'from' and classifies identically in both detail and list paths", () => {
  const nowSec = BASE_TIME;
  const from = FROM_24H;
  const to = nowSec;

  // Gangguan mulai 2 menit setelah 'from', selesai 12 menit setelah 'from' (durasi 10 menit = 600s)
  const incStart = from + 120;
  const incEnd = from + 720;

  const events = [
    { at: incStart, kind: "down", source: "live" },
    { at: incEnd, kind: "up", source: "live" },
  ];
  const priorEvent = { at: from - 7200, kind: "up", source: "live" };

  // Edge bucket sebelum mulai ada di (from - 300), yaitu di luar rentang [from, to] tapi dalam 10 menit sebelum incStart
  const edgeBucketBefore = makeBucket(from - 300, 300);
  const edgeBucketAfter = makeBucket(incEnd + 300, 300);
  const allBuckets = [edgeBucketBefore, edgeBucketAfter];
  const rangeBuckets = allBuckets.filter((b) => b.bucketStart >= from);

  const scope = {
    routerCustomers: 5,
    others: [],
  };

  // 1. Jalur Detail (getCustomerEvidence dengan incidentBuckets memuat bucket dari from - 3600)
  const evidence = buildCustomerEvidence({
    range: "24h",
    nowSec,
    buckets: rangeBuckets,
    incidentBuckets: allBuckets,
    events,
    priorEvent,
    scope,
  });

  // 2. Jalur List (listCustomerIncidentRows dengan query window dari incStart - 3600)
  const outages = buildOutages(events, priorEvent, from, to, nowSec);
  const listResult = buildIncidents({
    nowSec,
    from,
    to,
    outages,
    buckets: allBuckets,
    scope,
  });

  // Buktikan kedua jalur terbukti (real=1) dan hasilnya identik
  assert.equal(evidence.incidents.length, 1);
  assert.equal(listResult.incidents.length, 1);
  assert.equal(evidence.incidents[0].verdict, "terbukti");
  assert.equal(listResult.incidents[0].verdict, "terbukti");
  assert.ok(
    evidence.incidents[0].verdictReason.includes(
      "sampel antrean di bucket yang tumpang tindih tidak melebihi batas",
    ),
  );
  assert.equal(evidence.incidentSummary.real, 1);
  assert.equal(listResult.summary.real, 1);
  assert.deepEqual(evidence.incidents, listResult.incidents);
  assert.deepEqual(evidence.incidentSummary, listResult.summary);
});

test("nesting test across ranges on one fixture with a chain crossing the 3d boundary: same incident, same verdict, counts nested", () => {
  const nowSec = BASE_TIME;
  const from24h = nowSec - 24 * 3600;
  const from3d = nowSec - 3 * 24 * 3600;
  const from7d = nowSec - 7 * 24 * 3600;
  const from30d = nowSec - 30 * 24 * 3600;
  const from90d = nowSec - 90 * 24 * 3600;

  // Insiden 1: terjadi dalam 24h (mulai nowSec - 12h, durasi 30 menit)
  const inc1Start = nowSec - 12 * 3600;
  const inc1End = inc1Start + 1800;

  // Insiden 2: rantai flap yang menyeberangi batas 3d!
  // Mulai 1 jam sebelum batas 3d (from3d - 3600), lalu terus flap melintasi batas 3d hingga (from3d + 2400)
  const chainOutages = [
    {
      realStart: from3d - 3600,
      realEnd: from3d - 3000,
      from: from3d - 3600,
      to: from3d - 3000,
      seconds: 600,
      source: "live",
      windows: [],
    },
    {
      realStart: from3d - 2400,
      realEnd: from3d - 1800,
      from: from3d - 2400,
      to: from3d - 1800,
      seconds: 600,
      source: "live",
      windows: [],
    },
    {
      realStart: from3d - 1200,
      realEnd: from3d + 600,
      from: from3d - 1200,
      to: from3d + 600,
      seconds: 1800,
      source: "live",
      windows: [],
    },
    {
      realStart: from3d + 1200,
      realEnd: from3d + 2400,
      from: from3d + 1200,
      to: from3d + 2400,
      seconds: 1200,
      source: "live",
      windows: [],
    },
  ];

  // Insiden 3: terjadi di rentang 7d (hari ke-5)
  const inc3Start = nowSec - 5 * 24 * 3600;
  const inc3End = inc3Start + 1800;

  // Insiden 4: terjadi di rentang 30d (hari ke-20)
  const inc4Start = nowSec - 20 * 24 * 3600;
  const inc4End = inc4Start + 1800;

  // Insiden 5: terjadi di rentang 90d (hari ke-60)
  const inc5Start = nowSec - 60 * 24 * 3600;
  const inc5End = inc5Start + 1800;

  const allOutages = [
    {
      realStart: inc5Start,
      realEnd: inc5End,
      from: inc5Start,
      to: inc5End,
      seconds: 1800,
      source: "live",
      windows: [],
    },
    {
      realStart: inc4Start,
      realEnd: inc4End,
      from: inc4Start,
      to: inc4End,
      seconds: 1800,
      source: "live",
      windows: [],
    },
    {
      realStart: inc3Start,
      realEnd: inc3End,
      from: inc3Start,
      to: inc3End,
      seconds: 1800,
      source: "live",
      windows: [],
    },
    ...chainOutages,
    {
      realStart: inc1Start,
      realEnd: inc1End,
      from: inc1Start,
      to: inc1End,
      seconds: 1800,
      source: "live",
      windows: [],
    },
  ];

  // Sediakan edge samples untuk tiap insiden
  const buckets = [
    makeBucket(inc1Start - 300, 300),
    makeBucket(inc1End + 300, 300),
    makeBucket(from3d - 3900, 300),
    makeBucket(from3d + 2700, 300),
    makeBucket(inc3Start - 300, 300),
    makeBucket(inc3End + 300, 300),
    makeBucket(inc4Start - 300, 300),
    makeBucket(inc4End + 300, 300),
    makeBucket(inc5Start - 300, 300),
    makeBucket(inc5End + 300, 300),
  ];

  const res24h = buildIncidents({ nowSec, from: from24h, to: nowSec, outages: allOutages, buckets });
  const res3d = buildIncidents({ nowSec, from: from3d, to: nowSec, outages: allOutages, buckets });
  const res7d = buildIncidents({ nowSec, from: from7d, to: nowSec, outages: allOutages, buckets });
  const res30d = buildIncidents({ nowSec, from: from30d, to: nowSec, outages: allOutages, buckets });
  const res90d = buildIncidents({ nowSec, from: from90d, to: nowSec, outages: allOutages, buckets });

  // Verifikasi nesting angka: real(24h) <= real(3d) <= real(7d) <= real(30d) <= real(90d)
  assert.equal(res24h.summary.real, 1);
  assert.equal(res3d.summary.real, 1); // Rantai flap crossing batas 3d mulai sebelum batas 3d, jadi tidak masuk 3d
  assert.equal(res7d.summary.real, 3); // inc1 + rantai flap + inc3
  assert.equal(res30d.summary.real, 4); // inc1 + rantai flap + inc3 + inc4
  assert.equal(res90d.summary.real, 5); // inc1 + rantai flap + inc3 + inc4 + inc5

  assert.ok(res24h.summary.real <= res3d.summary.real);
  assert.ok(res3d.summary.real <= res7d.summary.real);
  assert.ok(res7d.summary.real <= res30d.summary.real);
  assert.ok(res30d.summary.real <= res90d.summary.real);

  // Verifikasi rantai flap di 7d, 30d, dan 90d memiliki id dan verdict yang sama persis
  const chainIn7d = res7d.incidents.find((i) => i.id === String(from3d - 3600));
  const chainIn30d = res30d.incidents.find((i) => i.id === String(from3d - 3600));
  const chainIn90d = res90d.incidents.find((i) => i.id === String(from3d - 3600));

  assert.ok(chainIn7d);
  assert.ok(chainIn30d);
  assert.ok(chainIn90d);
  assert.equal(chainIn7d.verdict, "terbukti");
  assert.equal(chainIn30d.verdict, "terbukti");
  assert.equal(chainIn90d.verdict, "terbukti");
  assert.equal(chainIn7d.outageCount, 4);
  assert.equal(chainIn30d.outageCount, 4);
  assert.equal(chainIn90d.outageCount, 4);
});

test("list/detail parity for 24h/3d/90d on the same fixture", () => {
  const nowSec = BASE_TIME;

  // Buat fixture dengan event di berbagai rentang waktu
  const t1 = nowSec - 10 * 3600; // di 24h
  const t2 = nowSec - 2 * 24 * 3600; // di 3d
  const t3 = nowSec - 50 * 24 * 3600; // di 90d

  const allEvents = [
    { at: t3, kind: "down", source: "live" },
    { at: t3 + 600, kind: "up", source: "live" },
    { at: t2, kind: "down", source: "live" },
    { at: t2 + 600, kind: "up", source: "live" },
    { at: t1, kind: "down", source: "live" },
    { at: t1 + 600, kind: "up", source: "live" },
  ];
  const priorEvent = { at: nowSec - 100 * 24 * 3600, kind: "up", source: "live" };

  const allBuckets = [
    makeBucket(t3 - 300, 300),
    makeBucket(t3 + 900, 300),
    makeBucket(t2 - 300, 300),
    makeBucket(t2 + 900, 300),
    makeBucket(t1 - 300, 300),
    makeBucket(t1 + 900, 300),
  ];

  const scope = {
    routerCustomers: 5,
    others: [],
  };

  const ranges = ["24h", "3d", "90d"];
  for (const r of ranges) {
    const rangeConfig = {
      "24h": 24 * 3600,
      "3d": 3 * 24 * 3600,
      "90d": 90 * 24 * 3600,
    };
    const from = nowSec - rangeConfig[r];
    const rangeBuckets = allBuckets.filter((b) => b.bucketStart >= from);

    // Jalur Detail
    const evidence = buildCustomerEvidence({
      range: r,
      nowSec,
      buckets: rangeBuckets,
      incidentBuckets: allBuckets,
      events: allEvents.filter((e) => e.at >= from),
      priorEvent,
      lookbackEvents: allEvents,
      lookbackPriorEvent: priorEvent,
      scope,
    });

    // Jalur List
    const lookbackStart = nowSec - 400 * 24 * 3600;
    const outages = buildOutages(allEvents, priorEvent, lookbackStart, nowSec, nowSec);
    const listResult = buildIncidents({
      nowSec,
      from,
      to: nowSec,
      outages,
      buckets: allBuckets,
      scope,
    });

    assert.equal(
      evidence.incidentSummary.real,
      listResult.summary.real,
      `Parity mismatch on range ${r} for real count`,
    );
    assert.equal(
      evidence.incidentSummary.realDownSeconds,
      listResult.summary.realDownSeconds,
      `Parity mismatch on range ${r} for realDownSeconds`,
    );
    assert.deepEqual(
      evidence.incidents,
      listResult.incidents,
      `Parity mismatch on range ${r} for incidents`,
    );
  }
});
