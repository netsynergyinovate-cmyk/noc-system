import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomerEvidence,
  classifyWibMinute,
} from "../src/lib/customer-evidence.ts";
import {
  OFF_PEAK_ID,
  WIB_OFFSET_SECONDS,
} from "../src/lib/customer-evidence-types.ts";

function makeWibEpoch(year, month, day, hour, min, sec = 0) {
  return (
    Math.floor(Date.UTC(year, month - 1, day, hour, min, sec) / 1000) -
    WIB_OFFSET_SECONDS
  );
}

test("WIB bucket classification at exact boundaries (12:30 belongs to pulang-sekolah, 23:00 is 'luar')", () => {
  // 12:29 -> siang
  assert.equal(classifyWibMinute(12 * 60 + 29), "siang");
  // 12:30 -> tepat batas masuk pulang-sekolah
  assert.equal(classifyWibMinute(12 * 60 + 30), "pulang-sekolah");
  // 15:29 -> pulang-sekolah
  assert.equal(classifyWibMinute(15 * 60 + 29), "pulang-sekolah");
  // 15:30 -> pulang-kerja
  assert.equal(classifyWibMinute(15 * 60 + 30), "pulang-kerja");
  // 17:29 -> pulang-kerja
  assert.equal(classifyWibMinute(17 * 60 + 29), "pulang-kerja");
  // 17:30 -> magrib-malam
  assert.equal(classifyWibMinute(17 * 60 + 30), "magrib-malam");
  // 22:59 -> magrib-malam
  assert.equal(classifyWibMinute(22 * 60 + 59), "magrib-malam");
  // 23:00 -> luar (di luar jam sibuk)
  assert.equal(classifyWibMinute(23 * 60), OFF_PEAK_ID);
  // 08:00 pagi -> luar
  assert.equal(classifyWibMinute(8 * 60), OFF_PEAK_ID);
});

test("open outage counted to now", () => {
  const nowSec = makeWibEpoch(2026, 10, 25, 14, 0, 0);
  const downAt = nowSec - 1800; // 30 menit yang lalu
  const evidence = buildCustomerEvidence({
    range: "24h",
    nowSec,
    buckets: [],
    events: [{ at: downAt, kind: "down", source: "live" }],
    priorEvent: {
      at: nowSec - 24 * 3600 - 100,
      kind: "up",
      source: "live",
    },
  });

  assert.equal(evidence.connection.state, "down");
  assert.equal(evidence.connection.since, downAt);
  assert.equal(evidence.connection.outages.length, 1);
  const outage = evidence.connection.outages[0];
  assert.equal(outage.from, downAt);
  assert.equal(outage.to, null);
  assert.equal(outage.seconds, 1800);
  assert.equal(evidence.connection.summary.outageCount, 1);
  assert.equal(evidence.connection.summary.downSeconds, 1800);
  assert.ok(
    evidence.findings.some(
      (f) => f.severity === "warn" && f.text.includes("sedang terputus"),
    ),
  );
});

test("outage clipped at range start via priorEvent", () => {
  const nowSec = makeWibEpoch(2026, 10, 25, 14, 0, 0);
  const from = nowSec - 24 * 3600;
  // Down 1 jam sebelum rentang dimulai
  const realDownStart = from - 3600;
  // Up 30 menit setelah rentang dimulai
  const upAt = from + 1800;

  const evidence = buildCustomerEvidence({
    range: "24h",
    nowSec,
    buckets: [],
    events: [{ at: upAt, kind: "up", source: "live" }],
    priorEvent: { at: realDownStart, kind: "down", source: "live" },
  });

  assert.equal(evidence.connection.outages.length, 1);
  const outage = evidence.connection.outages[0];
  assert.equal(outage.from, from); // Terpotong di awal rentang
  assert.equal(outage.to, upAt);
  assert.equal(outage.seconds, 1800);
  assert.equal(evidence.connection.summary.downSeconds, 1800);
  assert.equal(evidence.connection.state, "up");
  assert.equal(evidence.connection.since, upAt);
});

test("outage spanning 17:00-19:00 WIB splits seconds between 'pulang-kerja' and 'magrib-malam' exactly and across midnight WIB splits into two DayStat dates", () => {
  // Bagian 1: 17:00 - 19:00 WIB pada 2026-10-24
  // 17:00 - 17:30 = 1800 detik di 'pulang-kerja'
  // 17:30 - 19:00 = 5400 detik di 'magrib-malam'
  const t1700 = makeWibEpoch(2026, 10, 24, 17, 0, 0);
  const t1900 = makeWibEpoch(2026, 10, 24, 19, 0, 0);
  const nowSec1 = makeWibEpoch(2026, 10, 24, 21, 0, 0);

  const evidence1 = buildCustomerEvidence({
    range: "24h",
    nowSec: nowSec1,
    buckets: [],
    events: [
      { at: t1700, kind: "down", source: "live" },
      { at: t1900, kind: "up", source: "live" },
    ],
    priorEvent: {
      at: nowSec1 - 24 * 3600 - 10,
      kind: "up",
      source: "live",
    },
  });

  const pulangKerja = evidence1.windows.find((w) => w.id === "pulang-kerja");
  const magribMalam = evidence1.windows.find((w) => w.id === "magrib-malam");
  assert.equal(pulangKerja?.downSeconds, 1800);
  assert.equal(magribMalam?.downSeconds, 5400);

  const out1 = evidence1.connection.outages[0];
  assert.deepEqual(out1.windows, ["pulang-kerja", "magrib-malam"]);

  // Bagian 2: Melewati tengah malam WIB (23:30 WIB 2026-10-24 sampai 00:30 WIB 2026-10-25)
  // Total 3600 detik: 1800 detik di 2026-10-24, 1800 detik di 2026-10-25
  const t2330 = makeWibEpoch(2026, 10, 24, 23, 30, 0);
  const t0030 = makeWibEpoch(2026, 10, 25, 0, 30, 0);
  const nowSec2 = makeWibEpoch(2026, 10, 25, 12, 0, 0);

  const evidence2 = buildCustomerEvidence({
    range: "3d",
    nowSec: nowSec2,
    buckets: [],
    events: [
      { at: t2330, kind: "down", source: "live" },
      { at: t0030, kind: "up", source: "live" },
    ],
    priorEvent: {
      at: nowSec2 - 3 * 24 * 3600 - 10,
      kind: "up",
      source: "live",
    },
  });

  const day1 = evidence2.daily.find((d) => d.date === "2026-10-24");
  const day2 = evidence2.daily.find((d) => d.date === "2026-10-25");
  assert.ok(day1, "Day 2026-10-24 exists");
  assert.ok(day2, "Day 2026-10-25 exists");
  assert.equal(day1.downSeconds, 1800);
  assert.equal(day2.downSeconds, 1800);
  assert.equal(day1.windows[OFF_PEAK_ID].downSeconds, 1800);
  assert.equal(day2.windows[OFF_PEAK_ID].downSeconds, 1800);
});

test("duplicate consecutive events ignored", () => {
  const nowSec = makeWibEpoch(2026, 10, 25, 14, 0, 0);
  const from = nowSec - 24 * 3600;

  const t1 = from + 1000;
  const t2 = from + 1500; // duplicate down
  const t3 = from + 2000;
  const t4 = from + 2500; // duplicate up

  const evidence = buildCustomerEvidence({
    range: "24h",
    nowSec,
    buckets: [],
    events: [
      { at: t1, kind: "down", source: "live" },
      { at: t2, kind: "down", source: "alert" },
      { at: t3, kind: "up", source: "live" },
      { at: t4, kind: "up", source: "live" },
    ],
    priorEvent: { at: from - 100, kind: "up", source: "live" },
  });

  assert.equal(evidence.connection.outages.length, 1);
  const outage = evidence.connection.outages[0];
  assert.equal(outage.from, t1);
  assert.equal(outage.to, t3);
  assert.equal(outage.seconds, 1000);
  // Deduped events list contains only t1 and t3
  assert.equal(evidence.connection.events.length, 2);
});

test("uptime% math", () => {
  const nowSec = 10000;
  // 24h = 86400s
  const from = nowSec - 86400;

  // Gangguan total 8640 detik (10% dari 86400 detik)
  const evidence = buildCustomerEvidence({
    range: "24h",
    nowSec,
    buckets: [],
    events: [
      { at: from + 1000, kind: "down", source: "live" },
      { at: from + 9640, kind: "up", source: "live" },
    ],
    priorEvent: { at: from - 100, kind: "up", source: "live" },
  });

  assert.equal(evidence.connection.summary.uptimePct, 90);
});

test("weighted avg uses samples", () => {
  const nowSec = makeWibEpoch(2026, 10, 25, 14, 0, 0);
  // Jam 11:30 WIB (masuk siang)
  const b1Time = makeWibEpoch(2026, 10, 25, 11, 30, 0);
  const b2Time = makeWibEpoch(2026, 10, 25, 11, 35, 0);

  const evidence = buildCustomerEvidence({
    range: "24h",
    nowSec,
    buckets: [
      {
        bucketStart: b1Time,
        samples: 10,
        downAvg: 10,
        upAvg: 5,
        downMax: 15,
        upMax: 8,
      },
      {
        bucketStart: b2Time,
        samples: 90,
        downAvg: 20,
        upAvg: 10,
        downMax: 25,
        upMax: 12,
      },
    ],
    events: [],
    priorEvent: { at: nowSec - 24 * 3600 - 10, kind: "up", source: "live" },
  });

  const siang = evidence.windows.find((w) => w.id === "siang");
  assert.ok(siang);
  assert.equal(siang.bucketCount, 2);
  // Weighted: (10*10 + 90*20) / 100 = (100 + 1800) / 100 = 19.00
  assert.equal(siang.avgDownMbps, 19);
  // Weighted up: (10*5 + 90*10) / 100 = (50 + 900) / 100 = 9.50
  assert.equal(siang.avgUpMbps, 9.5);
});

test("no data -> state 'unknown', uptimePct null, a finding explaining", () => {
  const nowSec = makeWibEpoch(2026, 10, 25, 14, 0, 0);

  const evidence = buildCustomerEvidence({
    range: "24h",
    nowSec,
    buckets: [],
    events: [],
    priorEvent: null,
  });

  assert.equal(evidence.connection.state, "unknown");
  assert.equal(evidence.connection.since, null);
  assert.equal(evidence.connection.summary.uptimePct, null);
  assert.equal(evidence.connection.outages.length, 0);
  assert.equal(evidence.coverage.eventsCoverRange, false);
  assert.ok(
    evidence.findings.some(
      (f) => f.severity === "info" && f.text.includes("Tidak ada data"),
    ),
  );
});

test("coverage notes when trafficSince > from", () => {
  const nowSec = makeWibEpoch(2026, 10, 25, 14, 0, 0);
  const from = nowSec - 24 * 3600;
  const trafficSince = from + 3600; // Mulai tersimpan 1 jam setelah rentang mulai

  const evidence = buildCustomerEvidence({
    range: "24h",
    nowSec,
    buckets: [],
    events: [],
    priorEvent: { at: from - 100, kind: "up", source: "live" },
    trafficSince,
  });

  assert.equal(evidence.coverage.trafficSince, trafficSince);
  assert.ok(
    evidence.coverage.notes.some((n) =>
      n.includes("Data trafik baru tersimpan sejak"),
    ),
  );
  // expectedBuckets dihitung dari trafficSince, bukan from
  const expected = Math.floor((nowSec - trafficSince) / 300);
  assert.equal(evidence.coverage.expectedBuckets, expected);
});
