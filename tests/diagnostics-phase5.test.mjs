import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateBgp,
  evaluateDefaultRoute,
  evaluateIpv6,
  evaluatePing,
  evaluateUplinkHistory,
  evaluateUplinkRate,
  pickVerdict,
  rosDurationMs,
  rosRateBps,
} from "../src/lib/diagnostics.ts";

const now = new Date("2026-10-22T15:00:00Z");
const src = "Router uji";

// Baris asli /tool/ping router produksi ke 8.8.8.8.
const ping = (times, lostAt = []) => {
  let received = 0;
  return times.map((t, i) => {
    const lost = lostAt.includes(i);
    if (!lost) received++;
    return {
      seq: String(i),
      host: "8.8.8.8",
      sent: String(i + 1),
      received: String(received),
      ...(lost ? { status: "timeout" } : { time: t }),
    };
  });
};

test("durasi dan laju format RouterOS", () => {
  assert.equal(rosDurationMs("22ms379us"), 22.379);
  assert.equal(rosDurationMs("1s5ms"), 1005);
  assert.equal(rosDurationMs("850us"), 0.85);
  assert.equal(rosDurationMs(undefined), null);
  assert.equal(rosRateBps("1Gbps"), 1e9);
  assert.equal(rosRateBps("2.5Gbps"), 2.5e9);
  assert.equal(rosRateBps("100Mbps"), 1e8);
  assert.equal(rosRateBps("link-down"), null);
});

test("ping sehat, loss, jitter, dan hop yang menolak ICMP", () => {
  const ok = evaluatePing(
    "internet",
    "8.8.8.8",
    ping(["22ms379us", "21ms793us", "22ms244us", "22ms118us", "22ms783us"]),
    src,
    now,
  );
  assert.equal(ok.status, "ok");
  assert.match(ok.value, /loss 0% \(5\/5\), rata-rata 22\.3 ms/);
  const lossy = evaluatePing(
    "internet",
    "8.8.8.8",
    ping(Array(10).fill("22ms"), [3]),
    src,
    now,
  );
  assert.equal(lossy.status, "fail"); // 10% loss
  const jittery = evaluatePing(
    "internet",
    "8.8.8.8",
    ping(["10ms", "40ms", "10ms", "40ms"]),
    src,
    now,
  );
  assert.equal(jittery.status, "warn");
  const silentGw = evaluatePing(
    "gateway",
    "203.0.113.1",
    ping(["", "", ""], [0, 1, 2]),
    src,
    now,
  );
  assert.equal(silentGw.status, "unchecked");
  assert.equal(
    evaluatePing("gateway", "203.0.113.1", ping(["150ms", "150ms"]), src, now)
      .status,
    "fail",
  );
});

test("default route dan link uplink", () => {
  const route = [
    {
      active: "true",
      gateway: "203.0.113.1",
      "immediate-gw": "203.0.113.1%ether2-lan0",
    },
  ];
  const up = { name: "ether2-lan0", running: "true", "link-downs": "0" };
  assert.equal(
    evaluateDefaultRoute(
      route,
      up,
      { status: "link-ok", rate: "1Gbps" },
      src,
      now,
    ).status,
    "ok",
  );
  assert.equal(evaluateDefaultRoute([], up, null, src, now).status, "fail");
  assert.equal(
    evaluateDefaultRoute(route, up, { status: "no-link" }, src, now).status,
    "fail",
  );
});

test("utilisasi uplink terhadap kapasitas link", () => {
  const a = { "rx-byte": "0", "tx-byte": "0" };
  // 225 MB dalam 2 dtk = 900 Mbps unduh dari 1 Gbps.
  const busy = evaluateUplinkRate(
    "ether2-lan0",
    a,
    { "rx-byte": "225000000", "tx-byte": "1000" },
    2,
    1e9,
    src,
    now,
  );
  assert.equal(busy.status, "warn");
  assert.match(busy.value, /unduh 900\.0 Mbps.*90%/);
  assert.equal(
    evaluateUplinkRate(
      "vlan9",
      a,
      { "rx-byte": "1", "tx-byte": "1" },
      2,
      null,
      src,
      now,
    ).status,
    "unchecked",
  );
});

test("riwayat uplink & beban berbagi", () => {
  const base = { samples: 1800, avgMbps: 700, dayAvgMbps: 300 };
  const jenuh = evaluateUplinkHistory(
    { ...base, peakMbps: 960, customerMbps: 1, customerDayMbps: 5 },
    1e9,
    src,
    now,
  );
  assert.equal(jenuh[0].status, "fail");
  assert.equal(jenuh[1].status, "fail");
  assert.match(jenuh[1].detail, /berbagi bandwidth/);
  const longgar = evaluateUplinkHistory(
    { ...base, peakMbps: 400, customerMbps: 1, customerDayMbps: 5 },
    1e9,
    src,
    now,
  );
  assert.equal(longgar[0].status, "ok");
  assert.equal(longgar[1].status, "ok");
  assert.match(longgar[1].detail, /bukan berbagi/);
  assert.equal(
    evaluateUplinkHistory(
      {
        samples: 0,
        peakMbps: null,
        avgMbps: null,
        dayAvgMbps: null,
        customerMbps: null,
        customerDayMbps: null,
      },
      1e9,
      src,
      now,
    )[0].status,
    "unchecked",
  );
});

test("BGP: tidak dipakai, semua established, peer turun", () => {
  assert.equal(evaluateBgp([], [], src, now).value, "tidak dipakai");
  const conn = [
    { name: "isp-a", "remote.address": "203.0.113.1" },
    { name: "isp-b", "remote.address": "198.51.100.1" },
  ];
  const up = [
    {
      name: "isp-a-1",
      "remote.address": "203.0.113.1",
      established: "true",
      "prefix-count": "950000",
      uptime: "3d",
    },
  ];
  const down = evaluateBgp(conn, up, src, now);
  assert.equal(down.status, "fail");
  assert.match(down.detail, /isp-b/);
  assert.equal(evaluateBgp(conn.slice(0, 1), up, src, now).status, "ok");
});

test("IPv6: tidak dilayankan, route hilang, prefix pelanggan", () => {
  const linkLocal = [
    { address: "fe80::1/64", "link-local": "true" },
    { address: "::1/128" },
  ];
  assert.equal(
    evaluateIpv6(linkLocal, [], [], "<pppoe-a>", src, now).value,
    "tidak dilayankan",
  );
  const global = [...linkLocal, { address: "2001:db8::1/64" }];
  assert.equal(
    evaluateIpv6(global, [], [], "<pppoe-a>", src, now).status,
    "fail",
  );
  const route = [{ active: "true" }];
  assert.equal(
    evaluateIpv6(global, route, [], "<pppoe-a>", src, now).status,
    "warn",
  );
  assert.equal(
    evaluateIpv6(
      global,
      route,
      [{ server: "<pppoe-a>", address: "2001:db8:100::/56" }],
      "<pppoe-a>",
      src,
      now,
    ).status,
    "ok",
  );
});

test("kesimpulan: hulu bermasalah didahulukan dari perangkat pelanggan", () => {
  const route = evaluateDefaultRoute([], null, null, src, now);
  const onu = {
    layer: "optik",
    metric: "onu_rx",
    label: "Rx",
    value: "-28",
    threshold: "x",
    comparator: "=",
    status: "fail",
    detail: "",
    sourceRef: null,
    sampledAt: null,
  };
  assert.equal(pickVerdict([onu, route]).layer, "hulu");
});
