import test from "node:test";
import assert from "node:assert/strict";
import {
  auditRules,
  evaluateCustomerConnections,
  evaluateFasttrack,
  evaluateFilterBlock,
  evaluateMangle,
  evaluatePortForward,
  evaluateRaw,
  evaluateSrcNat,
  evaluateStaleRules,
  ruleScope,
} from "../src/lib/diagnostics.ts";

const now = new Date("2026-10-22T15:00:00Z");
const src = "Router uji";

// Rule asli router produksi (IP publik diganti 203.0.113.x).
const filter = [
  { ".id": "*1", chain: "forward", action: "reject", disabled: "true", "src-address-list": "RUNSNETISOLIR", "dst-address": "!203.0.113.0/20", protocol: "tcp", packets: "0", bytes: "0", comment: "RUNSNETISOLIR" },
  { ".id": "*C", chain: "input", action: "accept", protocol: "udp", "dst-port": "51820", packets: "13", bytes: "1168", comment: "Allow Inbound WireGuard" },
  { ".id": "*3", chain: "forward", action: "accept", "dst-address": "10.20.0.2", packets: "187164", bytes: "8684885", comment: "Allow Forwarding to OLT" },
  { ".id": "*6", chain: "forward", action: "drop", protocol: "tcp", "dst-port": "25,587,465,110,995", packets: "61", bytes: "3660" },
  { ".id": "*7", chain: "input", action: "drop", protocol: "tcp", "dst-port": "53", "in-interface": "vlan511-RUNSNET", packets: "0", bytes: "0" },
  { ".id": "*10", chain: "forward", action: "drop", "src-address": "10.30.0.0/21", packets: "0", bytes: "0", comment: "NOC-MGMT: modem tidak boleh ke tujuan lain" },
];
const nat = [
  { ".id": "*2", chain: "dstnat", action: "redirect", protocol: "tcp", "dst-port": "80,443", "src-address-list": "RUNSNETISOLIR", "to-ports": "3127", packets: "0", bytes: "0" },
  { ".id": "*4", chain: "dstnat", action: "redirect", protocol: "udp", "dst-port": "80,443", "src-address-list": "POOL-BRAS-RUNSNET-ISOLIR", "to-ports": "3127", packets: "0", bytes: "0" },
  { ".id": "*6", chain: "srcnat", action: "masquerade", "dst-address": "203.0.113.9", packets: "123563", bytes: "35720420" },
  { ".id": "*9", chain: "srcnat", action: "masquerade", "src-address-list": "POOL-BRAS-RUNSNET", packets: "6788977", bytes: "1730235057", comment: "nat-ip-local-internet" },
  { ".id": "*A", chain: "dstnat", action: "dst-nat", protocol: "tcp", "dst-address": "203.0.113.9", "dst-port": "1002", "to-addresses": "10.20.0.2", "to-ports": "80", packets: "158", bytes: "7793", comment: "nat-olt" },
  { ".id": "*D", chain: "srcnat", action: "masquerade", "src-address": "10.20.30.0/24", packets: "1", bytes: "150" },
];
const normal = { ip: "172.16.15.247", iface: "<pppoe-a@runsnet.id>", lists: ["POOL-BRAS-RUNSNET"] };
const isolir = { ip: "172.16.20.9", iface: "<pppoe-b@runsnet.id>", lists: ["POOL-BRAS-RUNSNET-ISOLIR"] };

test("cakupan rule: khusus, umum, tidak mengenai", () => {
  assert.equal(ruleScope(nat[3], normal), "khusus"); // masquerade src-address-list pelanggan
  assert.equal(ruleScope(filter[3], normal), "umum"); // drop SMTP untuk semua
  assert.equal(ruleScope(filter[5], normal), null); // hanya jaringan modem 10.30.0.0/21
  assert.equal(ruleScope(filter[4], normal), null); // input dari vlan upstream
  assert.equal(ruleScope(nat[1], normal), null); // redirect untuk pool isolir
  assert.equal(ruleScope(nat[1], isolir), "khusus");
  assert.equal(ruleScope({ chain: "forward", action: "drop", "in-interface-list": "WAN" }, normal), "mungkin");
  assert.equal(ruleScope({ chain: "dstnat", action: "dst-nat", "to-addresses": "172.16.15.247", "dst-port": "8080" }, normal), "khusus");
});

test("pelanggan normal: tidak diblokir, NAT keluar dari rule #3, tanpa fasttrack", () => {
  const hits = auditRules({ filter, raw: [], nat, mangle: [] }, normal);
  const block = evaluateFilterBlock(hits, src, now);
  assert.equal(block.status, "ok");
  assert.match(block.detail, /Kebijakan umum.*#3 drop.*hit 61/);
  const snat = evaluateSrcNat(hits, normal.ip, src, now);
  assert.equal(snat.status, "ok");
  // Rule umum #2 (dst-address tertentu) berada di atas #3 yang khusus pelanggan.
  assert.match(snat.value, /srcnat #2 masquerade/);
  assert.equal(evaluateRaw(hits, src, now).status, "ok");
  assert.equal(evaluateFasttrack(hits, [{ fasttrack: "false" }, { fasttrack: "false" }], src, now).status, "ok");
  assert.equal(evaluatePortForward(hits, nat, normal.ip, src, now).status, "ok");
});

test("pelanggan isolir: redirect udp 80,443 yang tidak pernah kena terdeteksi basi", () => {
  const hits = auditRules({ filter, raw: [], nat, mangle: [] }, isolir);
  const redirect = hits.find((h) => h.table === "nat" && h.index === 1);
  assert.equal(redirect.scope, "khusus");
  assert.equal(redirect.stale, true);
  const stale = evaluateStaleRules(hits, src, now);
  assert.match(stale.detail, /nat dstnat #1 redirect/);
  // Pool isolir tidak di-masquerade oleh #3; masih tertangkap rule umum #2 bila tujuan cocok.
  assert.equal(evaluateSrcNat(hits, isolir.ip, src, now).status, "ok");
  assert.match(evaluatePortForward(hits, nat, isolir.ip, src, now).detail, /Redirect/);
});

test("blokir khusus yang kena = fail; tertutup accept dicatat; IP privat tanpa NAT = fail", () => {
  const rules = [
    { chain: "forward", action: "accept", "src-address": "172.16.15.247", packets: "10", bytes: "1" },
    { chain: "forward", action: "drop", "src-address-list": "POOL-BRAS-RUNSNET", packets: "500", bytes: "1" },
  ];
  const hits = auditRules({ filter: rules, nat: [] }, normal);
  const block = evaluateFilterBlock(hits, src, now);
  assert.equal(block.status, "fail");
  assert.match(block.detail, /Tertutup accept/);
  assert.equal(evaluateSrcNat(hits, normal.ip, src, now).status, "fail");
});

test("fasttrack: rule atau koneksi nyata = fail", () => {
  const rule = [{ chain: "forward", action: "fasttrack-connection", "connection-state": "established,related", packets: "9", bytes: "9" }];
  const hits = auditRules({ filter: rule }, normal);
  assert.equal(evaluateFasttrack(hits, [], src, now).status, "fail");
  assert.equal(evaluateFasttrack([], [{ fasttrack: "true" }, { fasttrack: "false" }], src, now).status, "fail");
});

test("port forward ganda ke pelanggan: tabrakan dicatat", () => {
  const rules = [
    { chain: "dstnat", action: "dst-nat", protocol: "tcp", "dst-port": "8080", "to-addresses": "172.16.0.50", packets: "9", bytes: "1" },
    { chain: "dstnat", action: "dst-nat", protocol: "tcp", "dst-port": "8080", "to-addresses": "172.16.15.247", packets: "0", bytes: "0" },
  ];
  const hits = auditRules({ nat: rules }, normal);
  const pf = evaluatePortForward(hits, rules, normal.ip, src, now);
  assert.equal(pf.status, "warn");
  assert.match(pf.detail, /#0 menutupi #1/);
});

test("mangle: queue memakai packet-mark yang tidak dipasang = fail", () => {
  const mangle = [{ chain: "prerouting", action: "mark-packet", "src-address-list": "POOL-BRAS-RUNSNET", "new-packet-mark": "paket-10m", packets: "5", bytes: "1" }];
  const hits = auditRules({ mangle }, normal);
  assert.equal(evaluateMangle(hits, { "packet-marks": "paket-10m" }, [], src, now).status, "ok");
  assert.equal(evaluateMangle(hits, { "packet-marks": "paket-20m" }, [], src, now).status, "fail");
  assert.equal(evaluateMangle([], { "packet-marks": "" }, [], src, now).status, "ok");
});

test("koneksi pelanggan dan tracking mati", () => {
  const many = Array.from({ length: 3000 }, () => ({}));
  assert.equal(evaluateCustomerConnections([{}], [], { enabled: "auto" }, src, now).status, "ok");
  assert.equal(evaluateCustomerConnections(many, [], { enabled: "auto" }, src, now).status, "warn");
  assert.equal(evaluateCustomerConnections([], [], { enabled: "no" }, src, now).status, "fail");
});
