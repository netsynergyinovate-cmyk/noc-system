import test from "node:test";
import assert from "node:assert/strict";
import { niceStep, toPoint } from "../src/components/peta/traffic.ts";

const sample = (bytesDown, bytesUp, at) => ({
  downloadBps: 111,
  uploadBps: 222,
  downloadBytes: bytesDown,
  uploadBytes: bytesUp,
  sampledAt: at,
});

test("toPoint: rate dari selisih byte per detik", () => {
  // 125.000 byte dalam 1 detik = 1 Mbps
  assert.deepEqual(toPoint(sample(0, 0, 1000), sample(125_000, 12_500, 2000)), {
    t: 2000,
    down: 1_000_000,
    up: 100_000,
  });
});

test("toPoint: bacaan pertama dan penghitung reset memakai rate MikroTik", () => {
  assert.deepEqual(toPoint(null, sample(5, 5, 1000)), {
    t: 1000,
    down: 111,
    up: 222,
  });
  assert.deepEqual(toPoint(sample(900, 900, 1000), sample(10, 10, 2000)), {
    t: 2000,
    down: 111,
    up: 222,
  });
});

test("niceStep: langkah bulat yang 4 kalinya menutup puncak", () => {
  assert.equal(niceStep(47_400), 20_000);
  assert.equal(niceStep(20_000_000), 5_000_000);
  assert.equal(niceStep(0), 0.25);
  for (const peak of [1, 37, 999, 123_456, 9_999_999]) {
    assert.ok(niceStep(peak) * 4 >= peak);
  }
});

test("seriesUsageBytes: luas trapesium Mbps x detik / 8", async () => {
  const { seriesUsageBytes } =
    await import("../src/components/peta/traffic.ts");
  // 8 Mbps rata selama 10 detik = 10 MB; upload naik 0 -> 8 Mbps = rata 4 Mbps = 5 MB
  const u = seriesUsageBytes([
    { t: 0, down: 8, up: 0 },
    { t: 10_000, down: 8, up: 8 },
  ]);
  assert.equal(u.down, 10_000_000);
  assert.equal(u.up, 5_000_000);
  assert.deepEqual(seriesUsageBytes([{ t: 0, down: 5, up: 5 }]), {
    down: 0,
    up: 0,
  });
});
