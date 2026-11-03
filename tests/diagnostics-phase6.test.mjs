import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFlows, evaluateTrafficTrend } from "../src/lib/diagnostics.ts";

const now = new Date("2026-10-22T15:00:00Z");
const src = "uji";

test("tren trafik: sesuai kebiasaan, turun, melonjak, tanpa arsip", () => {
  const base = { windowUp: 0.4, windowPeakDown: 6, buckets: 12 };
  assert.equal(
    evaluateTrafficTrend(
      { ...base, windowDown: 3.5, baselineDown: 3.4 },
      src,
      now,
    ).status,
    "ok",
  );
  const drop = evaluateTrafficTrend(
    { ...base, windowDown: 0.5, baselineDown: 3.4 },
    src,
    now,
  );
  assert.equal(drop.status, "warn");
  assert.match(drop.detail, /turun ke 15%/);
  assert.match(
    evaluateTrafficTrend({ ...base, windowDown: 12, baselineDown: 3 }, src, now)
      .detail,
    /melonjak 4\.0×/,
  );
  assert.equal(
    evaluateTrafficTrend(
      { ...base, windowDown: 3, baselineDown: null },
      src,
      now,
    ).status,
    "ok",
  );
  assert.equal(
    evaluateTrafficTrend(
      {
        windowDown: null,
        windowUp: null,
        windowPeakDown: null,
        buckets: 0,
        baselineDown: null,
      },
      src,
      now,
    ).status,
    "unchecked",
  );
});

const row = (direction, peer, port, protocol, bytes, flows = 1) =>
  direction === "up"
    ? {
        direction,
        srcIp: "172.16.0.9",
        dstIp: peer,
        dstPort: port,
        protocol,
        bytes,
        flows,
      }
    : {
        direction,
        srcIp: peer,
        dstIp: "172.16.0.9",
        dstPort: port,
        protocol,
        bytes,
        flows,
      };

test("tren trafik: pemakaian rendah di jam yang memang sepi bukan penurunan", () => {
  const night = evaluateTrafficTrend(
    {
      windowDown: 0,
      windowUp: 0,
      windowPeakDown: 1.1,
      buckets: 12,
      baselineDown: 0.6,
    },
    src,
    now,
  );
  assert.equal(night.status, "ok");
  assert.match(night.detail, /biasa memakai di bawah 1 Mbps/);
});

test("NetFlow: tersebar wajar", () => {
  const f = evaluateFlows(
    [
      row("down", "142.250.0.1", 443, "TCP", 400e6),
      row("down", "157.240.0.1", 443, "TCP", 300e6),
      row("down", "0.0.0.0", 0, "lainnya", 100e6, 40),
      row("up", "142.250.0.1", 443, "TCP", 20e6),
    ],
    src,
    now,
  );
  assert.deepEqual(
    f.map((x) => x.status),
    ["ok", "ok", "ok"],
  );
  // Lawan yang sama dijumlahkan dari dua arah: unduh 400 MB + unggah 20 MB.
  assert.match(f[0].value, /142\.250\.0\.1:443 TCP 420\.0 MB \(51%\)/);
});

test("NetFlow: satu tujuan dominan, unggahan dominan, pola P2P", () => {
  const one = evaluateFlows(
    [
      row("down", "203.0.113.5", 443, "TCP", 900e6),
      row("down", "142.250.0.1", 443, "TCP", 50e6),
    ],
    src,
    now,
  );
  assert.equal(one[0].status, "warn");
  const upload = evaluateFlows(
    [
      row("up", "203.0.113.9", 443, "TCP", 600e6),
      row("down", "142.250.0.1", 443, "TCP", 100e6),
    ],
    src,
    now,
  );
  assert.equal(upload[1].status, "warn");
  const p2p = evaluateFlows(
    [
      row("down", "0.0.0.0", 0, "lainnya", 700e6, 900),
      row("up", "0.0.0.0", 0, "lainnya", 100e6, 400),
      row("down", "1.1.1.1", 443, "TCP", 100e6),
    ],
    src,
    now,
  );
  assert.equal(p2p[2].status, "warn");
});

test("NetFlow mengalir tetapi pelanggan tanpa aliran = tidak dapat diperiksa", () => {
  const f = evaluateFlows([], src, now);
  assert.equal(f.length, 1);
  assert.equal(f[0].status, "unchecked");
  assert.match(f[0].detail, /belum disimpan/);
  assert.match(f[0].detail, /agregat 10 lawan teratas/);
});
