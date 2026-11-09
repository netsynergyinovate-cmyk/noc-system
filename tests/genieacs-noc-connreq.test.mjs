import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const script = readFileSync(
  new URL(
    "../docker/genieacs/config/provisions/noc-connreq.js",
    import.meta.url,
  ),
  "utf8",
);
const preset = JSON.parse(
  readFileSync(
    new URL(
      "../docker/genieacs/config/presets/noc-connreq.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

// declare() tiruan: "DeviceID.ID" mengembalikan id; parameter ada bila ada di `params`.
// Math.random() dibuat deterministik per id perangkat, seperti GenieACS.
function run(deviceId, params, now = 1_760_000_000_000) {
  const calls = [];
  let seed = [...deviceId].reduce(
    (a, c) => (a * 31 + c.charCodeAt(0)) >>> 0,
    7,
  );
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const sandbox = {
    declare: (path, ts, v) => {
      calls.push({ path, ts, v });
      if (path === "DeviceID.ID") return { value: [deviceId, "xsd:string"] };
      return {
        value: path in params ? [params[path], "xsd:string"] : undefined,
      };
    },
    Date: { now: (i) => (i ? Math.floor(now / i) * i : now) },
    Math: {
      trunc: Math.trunc,
      MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
      random,
    },
  };
  vm.runInNewContext(script, sandbox, { timeout: 1000 });
  return calls;
}

const IGD_U =
  "InternetGatewayDevice.ManagementServer.ConnectionRequestUsername";
const IGD_P =
  "InternetGatewayDevice.ManagementServer.ConnectionRequestPassword";
const writes = (calls) => calls.filter((c) => c.v !== undefined);

test("menyetel username = noc_acs dan sandi deterministik berbasis deviceId", () => {
  const w = writes(run("D05FAF-FD511GW-DF77%2D2511027460", {}));
  const paths = w.map((c) => c.path);
  assert.ok(
    paths.includes(
      "InternetGatewayDevice.ManagementServer.ConnectionRequestUsername",
    ),
  );
  assert.ok(
    paths.includes(
      "InternetGatewayDevice.ManagementServer.ConnectionRequestPassword",
    ),
  );
  assert.ok(
    paths.includes("Device.ManagementServer.ConnectionRequestUsername"),
  );
  assert.ok(
    paths.includes("Device.ManagementServer.ConnectionRequestPassword"),
  );
  assert.ok(
    paths.includes(
      "InternetGatewayDevice.ManagementServer.PeriodicInformInterval",
    ),
  );
  assert.ok(paths.includes("Device.ManagementServer.PeriodicInformInterval"));
  const u = w.find(
    (c) =>
      c.path ===
      "InternetGatewayDevice.ManagementServer.ConnectionRequestUsername",
  );
  assert.equal(u.v.value, "noc_acs");
  const p = w.find(
    (c) =>
      c.path ===
      "InternetGatewayDevice.ManagementServer.ConnectionRequestPassword",
  );
  assert.match(p.v.value, /^CPE_/);
});

test("sandi stabil per perangkat dan berbeda antarperangkat", () => {
  const a1 = writes(run("DEV-A", {}))[1].v.value;
  const a2 = writes(run("DEV-A", {}))[1].v.value;
  const b = writes(run("DEV-B", {}))[1].v.value;
  assert.equal(
    a1,
    a2,
    "sandi harus sama setiap sesi supaya GenieACS tetap cocok",
  );
  assert.notEqual(a1, b);
});

test("menulis kredensial connection request dan interval inform 300s ke kedua root", () => {
  const w = writes(run("DEV-A", {}));
  const interval = w.find(
    (c) =>
      c.path ===
      "InternetGatewayDevice.ManagementServer.PeriodicInformInterval",
  );
  assert.equal(interval.v.value, 300);
  const intervalTr181 = w.find(
    (c) => c.path === "Device.ManagementServer.PeriodicInformInterval",
  );
  assert.equal(intervalTr181.v.value, 300);
});

test("modem TR-181 memakai root Device", () => {
  const w = writes(run("DEV-C", {}));
  const u = w.find(
    (c) => c.path === "Device.ManagementServer.ConnectionRequestUsername",
  );
  const p = w.find(
    (c) => c.path === "Device.ManagementServer.ConnectionRequestPassword",
  );
  assert.ok(u);
  assert.ok(p);
  assert.equal(u.v.value, "noc_acs");
  assert.match(p.v.value, /^CPE_/);
});

test("preset berlaku di setiap sesi dan menunjuk provision yang benar", () => {
  assert.equal(preset.configurations[0].name, "noc-connreq");
  assert.deepEqual(preset.events, {});
  assert.equal(preset.precondition, "");
  assert.notEqual(
    preset.channel,
    "noc-full",
    "channel sendiri: fault di sini tidak menghentikan pengambilan data penuh",
  );
});
