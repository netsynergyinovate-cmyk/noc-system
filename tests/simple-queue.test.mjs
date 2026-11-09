import test from "node:test";
import assert from "node:assert/strict";
import {
  filterSimpleQueues,
  formatBitrate,
  formatBytes,
  generateMockSimpleQueues,
} from "../src/lib/dashboard/routers.ts";

const customers = [
  {
    id: "c1",
    name: "Budi",
    pppoeUsername: "budi01",
    routerId: "router-1",
    billingStatus: "lunas",
    isOnline: true,
    planMbps: 20,
  },
  {
    id: "c2",
    name: "Dewi",
    pppoeUsername: "dewi02",
    routerId: "router-1",
    billingStatus: "lunas",
    isOnline: false,
    planMbps: 10,
  },
  {
    id: "c3",
    name: "Eko",
    pppoeUsername: "eko03",
    routerId: "router-1",
    billingStatus: "isolir",
    isOnline: true,
    planMbps: 10,
  },
  {
    id: "c4",
    name: "Sari",
    pppoeUsername: "sari04",
    routerId: "router-2",
    billingStatus: "lunas",
    isOnline: true,
    planMbps: 5,
  },
];

test("formatBitrate", () => {
  assert.equal(formatBitrate(0), "0 bps");
  assert.equal(formatBitrate(-5), "0 bps");
  assert.equal(formatBitrate(512), "512 bps");
  assert.equal(formatBitrate(1500), "1.5 kbps");
  assert.equal(formatBitrate(10_000_000), "10 Mbps");
  assert.equal(formatBitrate(2_500_000_000), "2.5 Gbps");
});

test("formatBytes", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(1023), "1023 B");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1024 ** 3), "1 GB");
});

test("generateMockSimpleQueues", () => {
  const qs = generateMockSimpleQueues("router-1", customers);
  assert.equal(qs.length, 3);
  assert.deepEqual(generateMockSimpleQueues("router-1", customers), qs); // deterministik
  assert.equal(generateMockSimpleQueues("router-9", customers).length, 0);
  assert.equal(generateMockSimpleQueues("router-1").length, 0);
  for (const q of qs) {
    assert.ok(q.maxLimit.upload > 0 && q.maxLimit.download > 0);
    assert.ok(
      q.rate.upload <= q.maxLimit.upload &&
        q.rate.download <= q.maxLimit.download,
    );
    assert.match(q.target, /^10\.20\.1\.\d+\/32$/);
  }
  const [online, offline, isolir] = qs;
  assert.equal(online.maxLimit.download, 20e6);
  assert.equal(online.maxLimit.upload, 10e6);
  assert.ok(
    online.rate.download >= 0.15 * 20e6 && online.rate.download <= 0.85 * 20e6,
  );
  assert.deepEqual(offline.rate, { upload: 0, download: 0 });
  assert.deepEqual(isolir.rate, { upload: 0, download: 0 });
  assert.equal(isolir.disabled, true);
  assert.equal(online.disabled, false);
});

test("filterSimpleQueues", () => {
  const qs = generateMockSimpleQueues("router-1", customers);
  assert.equal(filterSimpleQueues(qs, "").length, 3);
  assert.equal(filterSimpleQueues(qs, "BUDI").length, 1);
  assert.equal(filterSimpleQueues(qs, "10.20.1.2/32")[0].name, "dewi02");
  assert.equal(filterSimpleQueues(qs, "eko").length, 1); // komentar
  assert.equal(filterSimpleQueues(qs, "budi dewi").length, 0); // semua kata harus cocok
  assert.equal(filterSimpleQueues(qs, "", "active").length, 2);
  assert.equal(filterSimpleQueues(qs, "", "disabled").length, 1);
  assert.equal(filterSimpleQueues(qs, "eko", "active").length, 0);
});
