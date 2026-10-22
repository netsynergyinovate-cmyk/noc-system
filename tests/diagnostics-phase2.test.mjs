import test from "node:test";
import assert from "node:assert/strict";
import {
  addressContains,
  addressListMembership,
  evaluateAddressLists,
  evaluateArrears,
  evaluateBillingNetwork,
  evaluateConntrack,
  evaluateIpConflict,
  evaluateOnt,
  evaluatePonVlan,
  evaluatePppInterface,
  evaluateQueue,
  evaluateRunsnetStatus,
  pair,
  pickVerdict,
} from "../src/lib/diagnostics.ts";

const now = new Date("2026-10-22T10:00:00Z");
const src = "Router uji";

// Bentuk asli /rest/queue/simple?name=<pppoe-…> (RouterOS 7, router produksi).
const queue = (over = {}) => ({
  "max-limit": "15000000/15000000",
  rate: "3544/2224",
  dropped: "581/2342810",
  disabled: "false",
  dynamic: "true",
  name: "<pppoe-17060001902@runsnet.id>",
  ...over,
});

test("pair membaca format unggah/unduh RouterOS", () => {
  assert.deepEqual(pair("15000000/10000000"), [15000000, 10000000]);
  assert.deepEqual(pair(undefined), [0, 0]);
});

test("Queue: batas, pemakaian, drop", () => {
  const [limit, usage, drops] = evaluateQueue(
    queue(),
    queue({ dropped: "581/2342810" }),
    2,
    src,
    now,
  );
  assert.equal(limit.status, "ok");
  assert.equal(limit.value, "15.0/15.0 Mbps");
  assert.equal(usage.status, "ok");
  assert.equal(drops.status, "ok");

  const full = evaluateQueue(
    queue(),
    queue({ rate: "1000000/14500000", dropped: "590/2342900" }),
    2,
    src,
    now,
  );
  assert.equal(full[1].status, "warn");
  assert.match(full[1].value, /97%/);
});

test("Queue: drop dinilai sebagai persen paket, bukan jumlah mentah", () => {
  const q1 = queue({
    packets: "1000/1000",
    dropped: "0/0",
    queue: "default-small/default-small",
  });
  // Angka live TERI RAYA: 192 dibuang dari ~850 paket unduh dalam 2 dtk.
  const lossy = evaluateQueue(
    q1,
    queue({ packets: "1100/1660", dropped: "0/192" }),
    2,
    src,
    now,
  )[2];
  assert.equal(lossy.status, "warn");
  assert.match(lossy.value, /unduh 192 dari 852 \(22\.5%\)/);
  assert.match(lossy.detail, /default-small/);
  const light = evaluateQueue(
    q1,
    queue({ packets: "1100/2000", dropped: "0/5" }),
    2,
    src,
    now,
  )[2];
  assert.equal(light.status, "ok");
});

test("Queue: tidak ada, nonaktif, tanpa batas, penghitung reset", () => {
  assert.equal(evaluateQueue(null, null, 2, src, now)[0].status, "warn");
  assert.equal(
    evaluateQueue(queue({ disabled: "true" }), null, 2, src, now)[0].status,
    "warn",
  );
  assert.equal(
    evaluateQueue(queue({ "max-limit": "0/0" }), null, 2, src, now)[1].status,
    "unchecked",
  );
  assert.equal(
    evaluateQueue(queue(), queue({ dropped: "0/0" }), 2, src, now)[2].status,
    "unchecked",
  );
});

test("Antarmuka PPPoE: delta error dan drop", () => {
  const a = {
    "rx-error": "0",
    "tx-error": "0",
    "rx-drop": "0",
    "tx-drop": "2",
  };
  assert.equal(evaluatePppInterface(a, { ...a }, 2, src, now).status, "ok");
  assert.equal(
    evaluatePppInterface(a, { ...a, "rx-error": "3" }, 2, src, now).status,
    "warn",
  );
  assert.equal(evaluatePppInterface(null, a, 2, src, now).status, "unchecked");
});

test("VLAN PON: laju dari delta byte terhadap 1000 Mbps", () => {
  const v1 = { "tx-byte": "0", "rx-byte": "0" };
  // 212.5 MB dalam 2 dtk = 850 Mbps unduh.
  const busy = evaluatePonVlan(
    "vlan1105",
    v1,
    { "tx-byte": "212500000", "rx-byte": "1000000" },
    2,
    src,
    now,
  );
  assert.equal(busy.status, "warn");
  assert.match(busy.value, /unduh 850\.0 Mbps/);
  assert.equal(
    evaluatePonVlan(
      "vlan1105",
      v1,
      { "tx-byte": "1000", "rx-byte": "1000" },
      2,
      src,
      now,
    ).status,
    "ok",
  );
  assert.equal(evaluatePonVlan(null, v1, v1, 2, src, now).status, "unchecked");
});

test("Bentrok IP: entri ARP di antarmuka lain atau lease DHCP", () => {
  const ppp = "<pppoe-a>";
  assert.equal(
    evaluateIpConflict("172.16.0.9", ppp, [], [], src, now).status,
    "ok",
  );
  assert.equal(
    evaluateIpConflict("172.16.0.9", ppp, [{ interface: ppp }], [], src, now)
      .status,
    "ok",
  );
  const clash = evaluateIpConflict(
    "172.16.0.9",
    ppp,
    [{ interface: "ether2", "mac-address": "AA" }],
    [],
    src,
    now,
  );
  assert.equal(clash.status, "warn");
  assert.match(clash.detail, /ether2/);
});

test("Address-list: alamat tunggal, CIDR, rentang", () => {
  assert.ok(addressContains("172.16.0.9", "172.16.0.9"));
  assert.ok(addressContains("172.16.0.0/20", "172.16.15.254"));
  assert.ok(!addressContains("172.16.0.0/20", "172.16.16.1"));
  assert.ok(addressContains("172.16.20.2-172.16.20.254", "172.16.20.9"));
  assert.ok(!addressContains("example.com", "172.16.0.9"));
});

test("Address-list: pool isolir = fail, pool biasa = ok, entri nonaktif diabaikan", () => {
  const entries = [
    { list: "POOL-BRAS-RUNSNET", address: "172.16.0.0/20", disabled: "false" },
    {
      list: "POOL-BRAS-RUNSNET-ISOLIR",
      address: "172.16.20.0/24",
      disabled: "false",
    },
    { list: "BLOKIR", address: "172.16.0.9", disabled: "true" },
  ];
  const normal = addressListMembership("172.16.0.9", entries);
  assert.equal(normal.isolated, false);
  assert.equal(
    evaluateAddressLists("172.16.0.9", normal, src, now).status,
    "ok",
  );
  const isolir = addressListMembership("172.16.20.9", entries);
  assert.equal(isolir.isolated, true);
  assert.equal(
    evaluateAddressLists("172.16.20.9", isolir, src, now).status,
    "fail",
  );
});

test("Conntrack: persentase terhadap max-entries", () => {
  assert.equal(
    evaluateConntrack(
      { "total-entries": "8876", "max-entries": "1048576" },
      src,
      now,
    ).status,
    "ok",
  );
  assert.equal(
    evaluateConntrack(
      { "total-entries": "800000", "max-entries": "1048576" },
      src,
      now,
    ).status,
    "warn",
  );
  assert.equal(
    evaluateConntrack(
      { "total-entries": "1000000", "max-entries": "1048576" },
      src,
      now,
    ).status,
    "fail",
  );
});

const ont = (over = {}) => ({
  deviceId: "D05FAF-FD511GW-X",
  lastInform: new Date(now.getTime() - 60_000).toISOString(),
  uptimeSeconds: 90_000,
  activeClients: 4,
  rxDbm: -20,
  wans: [
    {
      kind: "PPPoE",
      username: "a@runsnet.id",
      status: "Connected",
      ip: "172.16.0.9",
    },
  ],
  ...over,
});

test("ONT: tidak ditemukan, basi, sehat", () => {
  assert.equal(
    evaluateOnt(null, "a@runsnet.id", null, now)[0].status,
    "unchecked",
  );
  const stale = evaluateOnt(
    ont({ lastInform: new Date(now.getTime() - 20 * 60_000).toISOString() }),
    "a@runsnet.id",
    -20,
    now,
  );
  assert.equal(stale.length, 1);
  assert.equal(stale[0].status, "warn");
  const fresh = evaluateOnt(ont(), "a@runsnet.id", -20.5, now);
  assert.deepEqual(
    fresh.map((f) => f.status),
    ["ok", "ok", "ok", "ok"],
  );
});

test("ONT: WAN putus, baru restart, Rx beda jauh dari OLT", () => {
  const f = evaluateOnt(
    ont({
      wans: [
        {
          kind: "PPPoE",
          username: "a@runsnet.id",
          status: "Disconnected",
          ip: "",
        },
      ],
      uptimeSeconds: 120,
    }),
    "a@runsnet.id",
    -26,
    now,
  );
  const by = Object.fromEntries(f.map((x) => [x.metric, x]));
  assert.equal(by.ont_wan.status, "fail");
  assert.equal(by.ont_uptime.status, "warn");
  assert.equal(by.ont_rx.status, "warn");
  assert.match(by.ont_rx.detail, /Selisih/);
});

test("Billing RunsNet: status dan tunggakan", () => {
  const base = {
    custId: "17060001902",
    connectivity: "Terhubung",
    syncedAt: now,
  };
  assert.equal(
    evaluateRunsnetStatus({ ...base, status: "Active" }).status,
    "ok",
  );
  assert.equal(
    evaluateRunsnetStatus({ ...base, status: "Isolir" }).status,
    "fail",
  );
  assert.equal(
    evaluateRunsnetStatus({ ...base, status: "Pending" }).status,
    "warn",
  );
  const inv = [
    { dueDate: "2026-10-20", status: "unpaid", remainingAmount: 150000 },
    { dueDate: "2026-11-20", status: "unpaid", remainingAmount: 150000 },
    { dueDate: "2026-09-20", status: "paid", remainingAmount: 0 },
  ];
  const a = evaluateArrears(inv, "2026-10-22", src, now);
  assert.equal(a.status, "warn");
  assert.match(a.value, /^1 tagihan/);
  assert.equal(
    evaluateArrears(inv.slice(1), "2026-10-22", src, now).status,
    "ok",
  );
});

test("Kesimpulan: tunggakan tidak menutupi queue penuh, isolir tetap menang", () => {
  const full = evaluateQueue(
    queue(),
    queue({ rate: "1000000/14500000" }),
    2,
    src,
    now,
  );
  const arrears = evaluateArrears(
    [{ dueDate: "2026-10-01", status: "unpaid", remainingAmount: 1 }],
    "2026-10-22",
    src,
    now,
  );
  assert.equal(pickVerdict([...full, arrears]).layer, "mikrotik");
  const isolir = evaluateRunsnetStatus({
    custId: "1",
    connectivity: null,
    syncedAt: now,
    status: "Isolir",
  });
  assert.equal(pickVerdict([...full, arrears, isolir]).layer, "billing");
});

test("Billing vs router: isolir tanpa sebab billing = fail", () => {
  const base = { sessionActive: true, sourceRef: src, sampledAt: now };
  assert.equal(
    evaluateBillingNetwork({
      ...base,
      billingStatus: "Active",
      isolatedInRouter: true,
    }).status,
    "fail",
  );
  assert.equal(
    evaluateBillingNetwork({
      ...base,
      billingStatus: "Isolir",
      isolatedInRouter: false,
    }).status,
    "warn",
  );
  assert.equal(
    evaluateBillingNetwork({
      ...base,
      billingStatus: "Isolir",
      isolatedInRouter: true,
    }).status,
    "ok",
  );
  assert.equal(
    evaluateBillingNetwork({
      ...base,
      billingStatus: "Terminate",
      isolatedInRouter: false,
    }).status,
    "warn",
  );
  assert.equal(
    evaluateBillingNetwork({
      ...base,
      billingStatus: "Active",
      sessionActive: null,
      isolatedInRouter: null,
    }).status,
    "unchecked",
  );
  assert.equal(
    evaluateBillingNetwork({
      ...base,
      billingStatus: null,
      isolatedInRouter: true,
    }).status,
    "unchecked",
  );
});
