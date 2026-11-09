import test from "node:test";
import assert from "node:assert/strict";

const { acsEndpoint, summarizeFleet } =
  await import("../src/lib/dashboard/genieacs-fleet.ts");

const NOW = 1_800_000_000;
const dev = (url, over = {}) => ({
  isOnline: false,
  lastInformAt: NOW - 7 * 3600,
  acs: { url, informEnabled: true, informIntervalSec: 300 },
  ...over,
});

test("acsEndpoint: skema, path, dan huruf besar tidak membedakan; port bawaan dilengkapi", () => {
  assert.equal(acsEndpoint("http://172.16.0.1:7547"), "172.16.0.1:7547");
  assert.equal(
    acsEndpoint("HTTP://ACS.Example.com:7547/tr069"),
    "acs.example.com:7547",
  );
  assert.equal(acsEndpoint("http://acs.example.com"), "acs.example.com:80");
  assert.equal(acsEndpoint("https://acs.example.com/"), "acs.example.com:443");
  assert.equal(acsEndpoint(""), null);
});

test("modem diarahkan ke ACS lain: terdeteksi dan dijelaskan, bukan dianggap rusak", () => {
  const s = summarizeFleet(
    [
      dev("http://172.16.0.1:7547"),
      dev("http://172.16.0.1:7547"),
      dev("http://10.0.0.5:7547", { isOnline: true }),
    ],
    "http://10.0.0.5:7547",
    NOW,
  );
  assert.equal(s.total, 3);
  assert.equal(s.reporting, 1);
  const other = s.groups.find((g) => g.url === "http://172.16.0.1:7547");
  assert.deepEqual([other.count, other.matchesConfigured], [2, false]);
  assert.equal(
    s.groups.find((g) => g.url === "http://10.0.0.5:7547").matchesConfigured,
    true,
  );
  assert.match(
    s.findings[0],
    /2 modem diarahkan ke ACS lain \(http:\/\/172\.16\.0\.1:7547\)/,
  );
});

test("tak ada yang melapor: temuan menyebut umur inform terbaru; ACS belum diatur: tidak menuduh salah arah", () => {
  const s = summarizeFleet([dev("http://172.16.0.1:7547")], "", NOW);
  assert.equal(s.groups[0].matchesConfigured, null);
  assert.equal(s.findings.length, 1);
  assert.match(s.findings[0], /Tidak ada modem yang melapor.*7 jam lalu/);
});

test("periodic inform mati dan interval dikelompokkan", () => {
  const s = summarizeFleet(
    [
      dev("a:7547", {
        acs: { url: "a:7547", informEnabled: false, informIntervalSec: 3600 },
      }),
      dev("a:7547"),
      dev("a:7547"),
    ],
    "a:7547",
    NOW,
  );
  assert.equal(s.informOff, 1);
  assert.deepEqual(s.intervals, [
    { sec: 300, count: 2 },
    { sec: 3600, count: 1 },
  ]);
  assert.ok(
    s.findings.some((f) => /1 modem mematikan periodic inform/.test(f)),
  );
});

test("hampir semua modem berhenti bersamaan: temuan menyebut jalur putus; berhenti berlainan waktu: tidak menuduh jalur", () => {
  const sameMoment = Array.from({ length: 10 }, (_, i) =>
    dev("a:7547", { lastInformAt: NOW - 8 * 3600 - i * 30 }),
  );
  assert.ok(
    summarizeFleet(sameMoment, "a:7547", NOW).findings.some((f) =>
      /10 dari 10 modem berhenti melapor bersamaan/.test(f),
    ),
  );

  const spread = Array.from({ length: 10 }, (_, i) =>
    dev("a:7547", { lastInformAt: NOW - 8 * 3600 - i * 86400 }),
  );
  assert.ok(
    !summarizeFleet(spread, "a:7547", NOW).findings.some((f) =>
      /bersamaan/.test(f),
    ),
  );
});
