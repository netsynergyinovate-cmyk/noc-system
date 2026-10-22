import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeLog,
  classifyLogLine,
  logLineMatcher,
  parseRouterLogTime,
} from "../src/lib/diagnostics.ts";

// Bentuk pesan asli dari buffer log router produksi (RouterOS 7).
const USER = "17060001103@runsnet.id";
const MAC = "D0:5F:AF:D3:7B:9E";
const cycle = (minute) => [
  ["pppoe,info", `PPPoE connection established from ${MAC}`],
  ["pppoe,ppp,info", `<pppoe-${USER}>: authenticated`],
  ["pppoe,ppp,info", `<pppoe-${USER}>: could not determine remote address, using 0.0.0.0`],
  ["pppoe,ppp,info", `<pppoe-${USER}>: connected`],
  ["pppoe,ppp,info,account", `${USER} logged in, 0.0.0.0 from ${MAC}`],
  ["interface,info", `<pppoe-${USER}> detect UNKNOWN`],
  ["pppoe,ppp,info", `<pppoe-${USER}>: terminating...`],
  ["pppoe,ppp,info", `<pppoe-${USER}>: disconnected`],
  ["pppoe,ppp,info,account", `${USER} logged out, 3 0 0 0 0 from ${MAC}`],
].map(([topics, message], i) => ({ topics, message, at: new Date(Date.UTC(2026, 9, 22, 12, minute, i)) }));

test("klasifikasi baris log RouterOS asli", () => {
  const kinds = cycle(0).map((l) => classifyLogLine(l).kind);
  assert.deepEqual(kinds, ["noise", "noise", "no_address", "noise", "login", "noise", "noise", "noise", "logout"]);
  assert.equal(classifyLogLine({ topics: "pppoe,ppp,info,account", message: `${USER} logged out, 3 0 0 0 0 from ${MAC}` }).sessionSec, 3);
  assert.equal(classifyLogLine({ topics: "system,info,account", message: "user Monitor logged in from 10.20.30.3 via rest-api" }).kind, "noise");
  assert.equal(classifyLogLine({ topics: "interface,info", message: "ether4-lan1 link down" }).kind, "link_down");
  assert.equal(classifyLogLine({ topics: "pppoe,ppp,error", message: `<pppoe-${USER}>: user ${USER} authentication failed` }).kind, "auth_fail");
});

test("pencocok baris: username, MAC, IP persis, dan link jalur", () => {
  const m = logLineMatcher({ username: USER, mac: MAC, ip: "172.16.0.9", interfaces: ["vlan1102", "ether4-lan1"] });
  assert.ok(m({ message: `${USER} logged in, 0.0.0.0 from x` }));
  assert.ok(m({ message: `PPPoE connection established from ${MAC.toLowerCase()}` }));
  assert.ok(m({ message: "address 172.16.0.9 conflict" }));
  assert.ok(!m({ message: "address 172.16.0.91 conflict" }));
  assert.ok(m({ message: "ether4-lan1 link down" }));
  assert.ok(!m({ message: "ether2-lan0 link down" }));
  assert.ok(!m({ message: "17060001104@runsnet.id logged in, 1.1.1.1 from x" }));
});

test("jam log router WIB", () => {
  const now = new Date("2026-10-22T13:00:00Z");
  assert.equal(parseRouterLogTime("2026-10-22 19:49:02", now).toISOString(), "2026-10-22T12:49:02.000Z");
  assert.equal(parseRouterLogTime("19:49:02", now).toISOString(), "2026-10-22T12:49:02.000Z");
  assert.equal(parseRouterLogTime("oct/22 19:49:02", now), null);
});

const analyze = (lines, over = {}) =>
  analyzeLog({
    lines,
    matches: logLineMatcher({ username: USER, mac: MAC, ip: null, interfaces: ["vlan1102", "ether4-lan1"] }),
    complaintAt: new Date(Date.UTC(2026, 9, 22, 12, 5)),
    now: new Date(Date.UTC(2026, 9, 22, 12, 10)),
    coverageStart: new Date(Date.UTC(2026, 9, 22, 10, 0)),
    sourceLabel: "Syslog tersimpan",
    sourceRef: "syslog_events",
    coverageHint: "Syslog tersimpan masih baru.",
    ...over,
  });

test("flapping tanpa alamat IP: putus berulang dan no_address = fail, derau disaring", () => {
  const lines = [0, 2, 4, 6].flatMap(cycle);
  const { findings, timeline } = analyze(lines);
  const by = Object.fromEntries(findings.map((f) => [f.metric, f]));
  assert.equal(by.log_coverage.status, "ok");
  assert.equal(by.ppp_flap.status, "fail");
  assert.match(by.ppp_flap.value, /4 kali \(3 sebelum, 1 sesudah keluhan\), sesi terpendek 3 dtk/);
  assert.equal(by.ppp_no_address.status, "fail");
  assert.equal(by.link_flap.status, "ok");
  assert.equal(by.log_noise.value, "24 baris");
  assert.ok(timeline.every((e, i) => i === 0 || e.at >= timeline[i - 1].at));
  assert.ok(timeline.some((e) => e.kind === "log_no_address"));
});

test("link jalur turun = fail; pelanggan lain tidak ikut terhitung", () => {
  const at = new Date(Date.UTC(2026, 9, 22, 12, 3));
  const { findings } = analyze([
    { topics: "interface,info", message: "ether4-lan1 link down", at },
    { topics: "interface,info", message: "ether4-lan1 link up (speed 1G, full duplex)", at },
    { topics: "pppoe,ppp,info,account", message: "17060001104@runsnet.id logged out, 50 0 0 0 0 from AA", at },
  ]);
  const by = Object.fromEntries(findings.map((f) => [f.metric, f]));
  assert.equal(by.link_flap.status, "fail");
  assert.equal(by.ppp_flap.status, "ok");
});

test("buffer router yang pendek: cakupan tidak dapat diperiksa, bukan normal", () => {
  const { findings } = analyze(cycle(4), { coverageStart: new Date(Date.UTC(2026, 9, 22, 11, 50)), sourceLabel: "Buffer memori router", coverageHint: "Aktifkan syslog remote router ke NOC." });
  const cov = findings.find((f) => f.metric === "log_coverage");
  assert.equal(cov.status, "unchecked");
  assert.match(cov.detail, /Aktifkan syslog remote/);
  const empty = analyze([], { coverageStart: null });
  assert.equal(empty.findings.length, 1);
  assert.equal(empty.findings[0].status, "unchecked");
});
