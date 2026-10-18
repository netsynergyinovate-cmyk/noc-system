import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const script = readFileSync(new URL("../docker/genieacs/config/provisions/noc-connreq.js", import.meta.url), "utf8");
const preset = JSON.parse(readFileSync(new URL("../docker/genieacs/config/presets/noc-connreq.json", import.meta.url), "utf8"));

// declare() tiruan: "DeviceID.ID" mengembalikan id; parameter ada bila ada di `params`.
// Math.random() dibuat deterministik per id perangkat, seperti GenieACS.
function run(deviceId, params, now = 1_760_000_000_000) {
  const calls = [];
  let seed = [...deviceId].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const sandbox = {
    declare: (path, ts, v) => {
      calls.push({ path, ts, v });
      if (path === "DeviceID.ID") return { value: [deviceId, "xsd:string"] };
      return { value: path in params ? [params[path], "xsd:string"] : undefined };
    },
    Date: { now: (i) => (i ? Math.floor(now / i) * i : now) },
    Math: { trunc: Math.trunc, MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER, random },
  };
  vm.runInNewContext(script, sandbox, { timeout: 1000 });
  return calls;
}

const IGD_U = "InternetGatewayDevice.ManagementServer.ConnectionRequestUsername";
const IGD_P = "InternetGatewayDevice.ManagementServer.ConnectionRequestPassword";
const writes = (calls) => calls.filter((c) => c.v !== undefined);

test("menyetel username = ID perangkat dan sandi acak, hanya dua parameter itu", () => {
  const w = writes(run("D05FAF-FD511GW-DF77%2D2511027460", { [IGD_U]: "ACS", [IGD_P]: "" }));
  assert.deepEqual(w.map((c) => c.path), [IGD_U, IGD_P]);
  assert.equal(w[0].v.value, "D05FAF-FD511GW-DF77%2D2511027460");
  assert.match(w[1].v.value, /^[0-9a-z]{6,}$/);
});

test("sandi stabil per perangkat dan berbeda antarperangkat", () => {
  const a1 = writes(run("DEV-A", { [IGD_U]: "x" }))[1].v.value;
  const a2 = writes(run("DEV-A", { [IGD_U]: "x" }))[1].v.value;
  const b = writes(run("DEV-B", { [IGD_U]: "x" }))[1].v.value;
  assert.equal(a1, a2, "sandi harus sama setiap sesi supaya GenieACS tetap cocok");
  assert.notEqual(a1, b);
});

test("sekali per hari: jendela harian, dan tidak menulis ke root yang tidak dipakai modem", () => {
  const calls = run("DEV-A", { [IGD_U]: "x" });
  for (const c of writes(calls)) assert.equal(c.ts.value % 86400000, 0);
  assert.equal(calls.some((c) => c.path.startsWith("Device.") && c.v !== undefined), false);
  assert.equal(writes(run("DEV-A", {})).length, 0, "modem tanpa parameter itu: tidak menulis apa pun");
});

test("modem TR-181 memakai root Device", () => {
  const u = "Device.ManagementServer.ConnectionRequestUsername";
  const w = writes(run("DEV-C", { [u]: "x" }));
  assert.deepEqual(w.map((c) => c.path), [u, "Device.ManagementServer.ConnectionRequestPassword"]);
});

test("preset berlaku di setiap sesi dan menunjuk provision yang benar", () => {
  assert.equal(preset.configurations[0].name, "noc-connreq");
  assert.deepEqual(preset.events, {});
  assert.equal(preset.precondition, "");
  assert.notEqual(preset.channel, "noc-full", "channel sendiri: fault di sini tidak menghentikan pengambilan data penuh");
});
