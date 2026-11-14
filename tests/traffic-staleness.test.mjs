import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { evaluateTrafficStaleness, TRAFFIC_STALENESS_THRESHOLD_SECONDS } =
  await import("../src/lib/dashboard/staleness.ts");

test("evaluateTrafficStaleness mengabaikan rentang non-live atau data belum ada", () => {
  assert.deepEqual(
    evaluateTrafficStaleness({
      isLive: false,
      lastDataReceivedAt: 100,
      nowSec: 200,
    }),
    {
      isStale: false,
      secondsSinceLastData: 0,
      cause: null,
    },
  );

  assert.deepEqual(
    evaluateTrafficStaleness({
      isLive: true,
      lastDataReceivedAt: null,
      nowSec: 200,
    }),
    {
      isStale: false,
      secondsSinceLastData: 0,
      cause: null,
    },
  );

  assert.deepEqual(
    evaluateTrafficStaleness({
      isLive: true,
      lastDataReceivedAt: 0,
      nowSec: 200,
    }),
    {
      isStale: false,
      secondsSinceLastData: 0,
      cause: null,
    },
  );
});

test("evaluateTrafficStaleness toleran terhadap jeda normal di bawah ambang batas (5s)", () => {
  const now = 1000;
  // Selang 1-4 detik tidak boleh flicker/memicu RTO
  for (let delta = 0; delta < TRAFFIC_STALENESS_THRESHOLD_SECONDS; delta++) {
    const res = evaluateTrafficStaleness({
      isLive: true,
      lastDataReceivedAt: now - delta,
      routerReachable: true,
      nowSec: now,
    });
    assert.equal(
      res.isStale,
      false,
      `delta ${delta}s tidak boleh dianggap stale`,
    );
    assert.equal(res.secondsSinceLastData, delta);
  }
});

test("evaluateTrafficStaleness menandai stale jika lewat ambang batas (>= 5s)", () => {
  const now = 1000;
  const res = evaluateTrafficStaleness({
    isLive: true,
    lastDataReceivedAt: now - 5,
    routerReachable: true,
    nowSec: now,
  });
  assert.equal(res.isStale, true);
  assert.equal(res.secondsSinceLastData, 5);

  const res10 = evaluateTrafficStaleness({
    isLive: true,
    lastDataReceivedAt: now - 10,
    routerReachable: true,
    nowSec: now,
  });
  assert.equal(res10.isStale, true);
  assert.equal(res10.secondsSinceLastData, 10);
});

test("evaluateTrafficStaleness langsung stale jika router dilaporkan unreachable oleh backend", () => {
  const now = 1000;
  const res = evaluateTrafficStaleness({
    isLive: true,
    lastDataReceivedAt: now - 1,
    routerReachable: false,
    nowSec: now,
  });
  assert.equal(res.isStale, true);
  assert.equal(res.secondsSinceLastData, 1);
});

test("evaluateTrafficStaleness memisahkan penyebab: koneksi aplikasi putus bukan RTO MikroTik", () => {
  const base = { isLive: true, lastDataReceivedAt: 990, nowSec: 1000 };
  assert.equal(
    evaluateTrafficStaleness({
      ...base,
      feedLive: false,
      routerReachable: false,
    }).cause,
    "feed",
    "WebSocket putus: status router dari backend basi, jangan salahkan MikroTik",
  );
  assert.equal(
    evaluateTrafficStaleness({ ...base, routerReachable: false }).cause,
    "router",
  );
  assert.equal(evaluateTrafficStaleness(base).cause, "nodata");
  assert.equal(
    evaluateTrafficStaleness({ ...base, lastDataReceivedAt: 999 }).cause,
    null,
  );
});
