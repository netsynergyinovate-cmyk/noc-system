import test from "node:test";
import assert from "node:assert/strict";
import { formatMikrotikConnReqRule } from "../src/lib/genieacs/mikrotik-firewall.ts";

test("formatMikrotikConnReqRule menyertakan src-address, dst-address, place-before=0", () => {
  const rule = formatMikrotikConnReqRule({
    serverIp: "192.168.0.220",
    ontIp: "172.16.15.227",
    port: 7547,
  });

  assert.ok(rule.includes("src-address=192.168.0.220"), "Wajib terkunci pada IP server GenieACS");
  assert.ok(rule.includes("dst-address=172.16.15.227"), "Wajib terkunci pada IP ONT tujuan");
  assert.ok(rule.includes("dst-port=7547"));
  assert.ok(rule.includes("protocol=tcp"));
  assert.ok(rule.includes("place-before=0"), "place-before=0 aman untuk list kosong");
  assert.ok(!rule.includes("place-before=1"), "place-before=1 bisa error out of range");
});

test("formatMikrotikConnReqRule dengan default aman bila argumen kosong", () => {
  const rule = formatMikrotikConnReqRule();
  assert.ok(rule.includes("src-address=<IP_SERVER_GENIEACS>"));
  assert.ok(rule.includes("dst-address=<IP_ONT>"));
  assert.ok(rule.includes("dst-port=7547"));
  assert.ok(rule.includes("place-before=0"));
});
