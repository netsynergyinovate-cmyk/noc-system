import test from "node:test";
import assert from "node:assert/strict";
import {
  getNetflowTimeline,
  flowHistoryStepSeconds,
  flowRangeSeconds,
} from "../src/lib/dashboard/netflow.ts";

const NOW = 1_800_000_000;
const expectedStep = { "1h": 60, "6h": 300, "24h": 900, "7d": 7200 };

for (const range of ["1h", "6h", "24h", "7d"]) {
  test(`riwayat ${range}: kronologis, step ${expectedStep[range]}s, berakhir di now`, () => {
    const h = getNetflowTimeline(NOW, range);
    assert.equal(h.range, range);
    assert.equal(flowHistoryStepSeconds[range], expectedStep[range]);
    assert.equal(h.points.length, flowRangeSeconds[range] / expectedStep[range]);
    assert.equal(h.points.at(-1).at, NOW);
    for (let i = 1; i < h.points.length; i++)
      assert.equal(h.points[i].at - h.points[i - 1].at, expectedStep[range]);
    for (const p of h.points) {
      assert.ok(p.bytesPerSec >= 0 && p.packetsPerSec >= 0);
      assert.ok(p.topApp === undefined || typeof p.topApp === "string");
    }
    assert.ok(h.points.some((p) => p.bytesPerSec > 0));
  });
}

test("deterministik dan filter protocol mengurangi trafik", () => {
  assert.deepEqual(getNetflowTimeline(NOW, "24h"), getNetflowTimeline(NOW, "24h"));
  const sum = (h) => h.points.reduce((s, p) => s + p.bytesPerSec, 0);
  const all = getNetflowTimeline(NOW, "24h", { protocol: "ALL" });
  const udp = getNetflowTimeline(NOW, "24h", { protocol: "UDP" });
  assert.ok(sum(udp) < sum(all));
});
