import test from "node:test";
import assert from "node:assert/strict";
import {
  diagnosticLayers,
  unchecked,
  evaluatePppoe,
  evaluateOptical,
  evaluateBilling,
  evaluateBillingNetwork,
  evaluateRunsnetStatus,
  evaluateArrears,
  evaluateQueue,
  evaluatePppInterface,
  evaluatePonVlan,
  evaluateIpConflict,
  evaluateAddressLists,
  evaluateConntrack,
  evaluateOnt,
  analyzeLog,
  evaluateFilterBlock,
  evaluateRaw,
  evaluateSrcNat,
  evaluatePortForward,
  evaluateFasttrack,
  evaluateCustomerConnections,
  evaluateMangle,
  evaluateStaleRules,
  evaluateDefaultRoute,
  evaluateUplinkRate,
  evaluatePing,
  evaluateUplinkHistory,
  evaluateBgp,
  evaluateIpv6,
  evaluateTrafficTrend,
  evaluateFlows,
  evaluateCustomerPing,
  evaluateTraceroute,
  evaluateDns,
  evaluateRateBaseline,
} from "../src/lib/diagnostics.ts";

const now = new Date("2026-10-25T12:00:00Z");
const src = "uji_invariants";
const validLayers = new Set(diagnosticLayers.map((l) => l.id));
const validStatuses = new Set(["ok", "warn", "fail", "unchecked"]);

function assertFindingInvariants(f, context = "") {
  assert.ok(f, `${context}: finding harus terdefinisi`);
  assert.ok(
    validLayers.has(f.layer),
    `${context}: layer '${f.layer}' harus ada di diagnosticLayers`,
  );
  assert.ok(
    validStatuses.has(f.status),
    `${context}: status '${f.status}' harus valid`,
  );
  assert.ok(
    typeof f.metric === "string" && f.metric.trim().length > 0,
    `${context}: metric tidak boleh kosong`,
  );
  assert.ok(
    typeof f.label === "string" && f.label.trim().length > 0,
    `${context}: label tidak boleh kosong`,
  );
  assert.ok(
    typeof f.detail === "string" && f.detail.trim().length > 0,
    `${context}: detail tidak boleh kosong`,
  );
}

test("unchecked() selalu menghasilkan status unchecked dan detail non-kosong", () => {
  const f1 = unchecked("billing", "m1", "L1", "Alasan jelas", src);
  assert.equal(f1.status, "unchecked");
  assert.equal(f1.detail, "Alasan jelas");
  assertFindingInvariants(f1, "unchecked normal");

  // Jika alasan kosong atau hanya spasi, fallback ke 'alasan tidak dicatat'
  const f2 = unchecked("mikrotik", "m2", "L2", "");
  assert.equal(f2.status, "unchecked");
  assert.equal(f2.detail, "alasan tidak dicatat");
  assertFindingInvariants(f2, "unchecked string kosong");

  const f3 = unchecked("optik", "m3", "L3", "   ");
  assert.equal(f3.status, "unchecked");
  assert.equal(f3.detail, "alasan tidak dicatat");
  assertFindingInvariants(f3, "unchecked spasi");
});

test("invarian: input kosong/null menghasilkan temuan unchecked dengan detail non-kosong", () => {
  const emptyEvaluators = [
    {
      name: "evaluatePppoe(null)",
      run: () => [evaluatePppoe(null)],
    },
    {
      name: "evaluatePppoe({ username: '' })",
      run: () => [
        evaluatePppoe({
          routerName: "R1",
          username: "",
          session: null,
          error: null,
          readAt: now,
        }),
      ],
    },
    {
      name: "evaluateOptical(null)",
      run: () => [evaluateOptical(null, now)],
    },
    {
      name: "evaluateBilling(null)",
      run: () => [evaluateBilling(null)],
    },
    {
      name: "evaluateBillingNetwork(status null)",
      run: () => [
        evaluateBillingNetwork({
          billingStatus: null,
          sessionActive: null,
          isolatedInRouter: null,
          sourceRef: src,
          sampledAt: now,
        }),
      ],
    },
    {
      name: "evaluateRunsnetStatus(null)",
      run: () => [evaluateRunsnetStatus(null)],
    },
    {
      name: "evaluateRunsnetStatus({ status: '' })",
      run: () => [
        evaluateRunsnetStatus({
          custId: "C1",
          status: "",
          connectivity: null,
          syncedAt: now,
        }),
      ],
    },
    {
      name: "evaluateArrears(null)",
      run: () => [evaluateArrears(null, "2026-10-25", src, now)],
    },
    {
      name: "evaluateArrears(today kosong)",
      run: () => [evaluateArrears([], "", src, now)],
    },
    {
      name: "evaluatePppInterface(null, null)",
      run: () => [evaluatePppInterface(null, null, 1, src, now)],
    },
    {
      name: "evaluatePonVlan(null vlan)",
      run: () => [evaluatePonVlan(null, null, null, 1, src, now)],
    },
    {
      name: "evaluateIpConflict(ip kosong)",
      run: () => [evaluateIpConflict("", "pppoe-1", [], [], src, now)],
    },
    {
      name: "evaluateAddressLists(ip kosong)",
      run: () => [
        evaluateAddressLists(
          "",
          { lists: [], isolated: false, blocked: [] },
          src,
          now,
        ),
      ],
    },
    {
      name: "evaluateConntrack(max-entries 0)",
      run: () => [evaluateConntrack({}, src, now)],
    },
    {
      name: "evaluateOnt(null)",
      run: () => evaluateOnt(null, "budi", null, now),
    },
    {
      name: "analyzeLog(tanpa cakupan)",
      run: () =>
        analyzeLog({
          lines: [],
          matches: () => false,
          complaintAt: now,
          now,
          coverageStart: null,
          sourceLabel: "Buffer",
          sourceRef: src,
          coverageHint: "Cek syslog",
        }).findings,
    },
    {
      name: "evaluateSrcNat(ip kosong)",
      run: () => [evaluateSrcNat([], "", src, now)],
    },
    {
      name: "evaluatePortForward(ip kosong)",
      run: () => [evaluatePortForward([], [], "", src, now)],
    },
    {
      name: "evaluateCustomerConnections(semua null)",
      run: () => [evaluateCustomerConnections(null, null, null, src, now)],
    },
    {
      name: "evaluateUplinkRate(gapSec 0)",
      run: () => [evaluateUplinkRate("eth1", null, null, 0, null, src, now)],
    },
    {
      name: "evaluatePing(rows kosong)",
      run: () => [evaluatePing("gateway", "1.1.1.1", [], src, now)],
    },
    {
      name: "evaluateUplinkHistory(samples 0)",
      run: () =>
        evaluateUplinkHistory(
          {
            samples: 0,
            peakMbps: null,
            avgMbps: null,
            dayAvgMbps: null,
            customerMbps: null,
            customerDayMbps: null,
          },
          null,
          src,
          now,
        ),
    },
    {
      name: "evaluateTrafficTrend(buckets 0)",
      run: () => [
        evaluateTrafficTrend(
          {
            buckets: 0,
            windowDown: null,
            windowUp: null,
            windowPeakDown: null,
            baselineDown: null,
          },
          src,
          now,
        ),
      ],
    },
    {
      name: "evaluateFlows(rows kosong)",
      run: () => evaluateFlows([], src, now),
    },
    {
      name: "evaluateCustomerPing(address null)",
      run: () => [evaluateCustomerPing(null, null, src, now)],
    },
    {
      name: "evaluateTraceroute(hops kosong)",
      run: () => [evaluateTraceroute("1.1.1.1", [], src, now)],
    },
    {
      name: "evaluateDns(probe null)",
      run: () => [evaluateDns(null, src, now)],
    },
    {
      name: "evaluateRateBaseline(buckets kurang)",
      run: () =>
        evaluateRateBaseline(
          {
            buckets: 5,
            currentDown: null,
            currentUp: null,
            currentPeakDown: null,
            p95Down: null,
            p95Up: null,
            limitDown: null,
            limitUp: null,
          },
          src,
          now,
        ),
    },
  ];

  for (const { name, run } of emptyEvaluators) {
    const findings = run();
    assert.ok(
      findings.length > 0,
      `${name} harus mengembalikan setidaknya 1 temuan (tidak boleh hilang tanpa jejak)`,
    );
    for (const f of findings) {
      assertFindingInvariants(f, name);
      assert.equal(
        f.status,
        "unchecked",
        `${name} harus menghasilkan status 'unchecked', bukan '${f.status}'`,
      );
    }
  }
});

test("invarian: semua temuan dari masukan normal memenuhi aturan detail, layer, dan status", () => {
  const normalEvaluatorRuns = [
    () => [
      evaluatePppoe({
        routerName: "R1",
        username: "budi",
        session: {
          address: "10.0.0.2",
          uptime: "1d",
          callerId: "00:11:22:33:44:55",
        },
        error: null,
        readAt: now,
      }),
    ],
    () => [
      evaluateOptical(
        {
          oltName: "OLT1",
          ponIndex: 1,
          onuIndex: 1,
          rxPower: -19.5,
          status: "online",
          capturedAt: now,
        },
        now,
      ),
    ],
    () => [
      evaluateBilling({
        status: "active",
        syncedAt: now,
        billingName: "RunsNet",
      }),
    ],
    () =>
      evaluateQueue(
        { "max-limit": "10M/10M", rate: "2M/2M" },
        { "max-limit": "10M/10M", rate: "2M/2M" },
        5,
        src,
        now,
      ),
    () => [
      evaluatePppInterface(
        { "rx-error": "0", "tx-error": "0", "rx-drop": "0", "tx-drop": "0" },
        { "rx-error": "0", "tx-error": "0", "rx-drop": "0", "tx-drop": "0" },
        5,
        src,
        now,
      ),
    ],
    () => [
      evaluatePonVlan(
        "vlan100",
        { "tx-byte": "1000000", "rx-byte": "1000000" },
        { "tx-byte": "2000000", "rx-byte": "2000000" },
        5,
        src,
        now,
      ),
    ],
    () => [evaluateIpConflict("10.0.0.2", "pppoe-budi", [], [], src, now)],
    () => [
      evaluateAddressLists(
        "10.0.0.2",
        { lists: ["pelanggan_aktif"], isolated: false, blocked: [] },
        src,
        now,
      ),
    ],
    () => [
      evaluateConntrack(
        { "total-entries": "1000", "max-entries": "100000" },
        src,
        now,
      ),
    ],
    () => [
      evaluateFilterBlock([], src, now),
      evaluateRaw([], src, now),
      evaluateSrcNat([], "100.64.0.2", src, now),
      evaluatePortForward([], [], "100.64.0.2", src, now),
      evaluateFasttrack([], [], src, now),
      evaluateCustomerConnections([], [], { enabled: "yes" }, src, now),
      evaluateMangle([], null, [], src, now),
      evaluateStaleRules([], src, now),
    ],
    () => [
      evaluateDefaultRoute(
        [{ active: "true", disabled: "false", gateway: "192.168.1.1" }],
        { name: "sfp-sfpplus1", running: "true" },
        { status: "link-ok", rate: "1Gbps" },
        src,
        now,
      ),
    ],
    () => [
      evaluateUplinkRate(
        "sfp-sfpplus1",
        { "rx-byte": "10000000", "tx-byte": "10000000" },
        { "rx-byte": "20000000", "tx-byte": "20000000" },
        5,
        1e9,
        src,
        now,
      ),
    ],
    () => [
      evaluatePing(
        "gateway",
        "192.168.1.1",
        [{ sent: "5", received: "5", time: "2ms" }],
        src,
        now,
      ),
    ],
    () => [
      evaluateBgp([], [], src, now),
      evaluateIpv6([], [], [], null, src, now),
    ],
    () => [
      evaluateTrafficTrend(
        {
          buckets: 24,
          windowDown: 5,
          windowUp: 1,
          windowPeakDown: 8,
          baselineDown: 5,
          plan: { downMbps: 10, upMbps: 10 },
        },
        src,
        now,
      ),
    ],
    () =>
      evaluateFlows(
        [
          {
            direction: "down",
            srcIp: "1.1.1.1",
            dstIp: "10.0.0.2",
            dstPort: 443,
            protocol: "TCP",
            bytes: 1e7,
            flows: 10,
          },
        ],
        src,
        now,
        { downMbps: 10, upMbps: 10, peakUpMbps: 0.5 },
      ),
    () => [
      evaluateCustomerPing(
        "10.0.0.2",
        { sent: 10, received: 10, avgMs: 5, maxMs: 10, jitterMs: 1 },
        src,
        now,
      ),
    ],
    () => [
      evaluateTraceroute(
        "8.8.8.8",
        [
          { hop: 1, address: "192.168.1.1", lossPct: 0, avgMs: 2 },
          { hop: 2, address: "8.8.8.8", lossPct: 0, avgMs: 15 },
        ],
        src,
        now,
      ),
    ],
    () => [
      evaluateDns(
        { name: "google.com", ok: true, rttMs: 12, error: null },
        src,
        now,
      ),
    ],
    () =>
      evaluateRateBaseline(
        {
          buckets: 30,
          currentDown: 6.0,
          currentUp: 2.0,
          currentPeakDown: 8.0,
          p95Down: 7.0,
          p95Up: 3.0,
          limitDown: 10.0,
          limitUp: 10.0,
        },
        src,
        now,
      ),
  ];

  let totalFindingsChecked = 0;
  for (const fn of normalEvaluatorRuns) {
    const list = fn();
    for (const f of list) {
      assertFindingInvariants(f, `normal eval [${f.layer}:${f.metric}]`);
      totalFindingsChecked++;
    }
  }

  assert.ok(
    totalFindingsChecked >= 25,
    `Harus memeriksa setidaknya 25 temuan normal, terperiksa: ${totalFindingsChecked}`,
  );
});
