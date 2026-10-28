import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const script = readFileSync(new URL("../docker/genieacs/config/provisions/noc-full.js", import.meta.url), "utf8");
const preset = JSON.parse(
  readFileSync(new URL("../docker/genieacs/config/presets/noc-full.json", import.meta.url), "utf8"),
);

const BRANCHES = {
  InternetGatewayDevice: ["DeviceInfo", "LANDevice", "WANDevice", "X_CMS_PrivateNode", "X_ALU_OntOpticalParam"],
  Device: [],
};

// Menjalankan provision dengan declare() tiruan dan Date.now(interval) ala GenieACS.
// declare() pada "<root>.*" mengembalikan cabang yang "ada" di modem tiruan.
function run(now = 1_760_000_000_000, branches = BRANCHES) {
  const calls = [];
  const sandbox = {
    declare: (p, ts, v) => {
      calls.push({ path: p, ts, v });
      const m = /^(InternetGatewayDevice|Device)\.\*$/.exec(p);
      return m ? branches[m[1]].map((b) => ({ path: `${m[1]}.${b}` })) : [];
    },
    Date: { now: (interval) => (interval ? Math.floor(now / interval) * interval : now) },
  };
  vm.runInNewContext(script, sandbox, { timeout: 1000 });
  return calls;
}

test("provision noc-full valid dan hanya membaca (tidak menulis nilai ke modem)", () => {
  assert.doesNotThrow(() => new vm.Script(script));
  const calls = run();
  assert.ok(calls.length > 0);
  for (const c of calls) {
    assert.equal(typeof c.path, "string");
    assert.equal(c.v, undefined, "declare dengan nilai ketiga akan MENULIS ke modem");
  }
});

test("seluruh pohon: tiap cabang ditelusuri sampai kedalaman penuh dengan jendela harian", () => {
  const calls = run();
  for (const branch of ["DeviceInfo", "LANDevice", "WANDevice", "X_ALU_OntOpticalParam"]) {
    for (let depth = 1; depth <= 8; depth++) {
      const p = `InternetGatewayDevice.${branch}` + ".*".repeat(depth);
      const c = calls.find((x) => x.path === p);
      assert.ok(c, `hilang: ${p}`);
      assert.equal(c.ts.path, c.ts.value, "path dan value memakai jendela yang sama");
      assert.equal(c.ts.path % 86400000, 0, "jendela harian");
    }
    assert.equal(calls.some((x) => x.path === `InternetGatewayDevice.${branch}` + ".*".repeat(9)), false);
  }
  const top = calls.find((x) => x.path === "InternetGatewayDevice.*");
  assert.ok(top, "parameter tingkat pertama harus ikut dibaca");
});

test("cabang yang diketahui membuat fault 9002 dilewati sepenuhnya", () => {
  const calls = run();
  assert.equal(
    calls.some((c) => c.path.includes("X_CMS_PrivateNode")),
    false,
    "membaca X_CMS_PrivateNode.voip_mivas membuat modem menjawab fault 9002 dan membatalkan seluruh pembacaan",
  );
});

test("root yang tidak dipakai modem (tanpa cabang) tidak membaca apa-apa di bawahnya", () => {
  const calls = run();
  assert.equal(calls.some((c) => c.path.startsWith("Device.") && c.path !== "Device.*" && !c.path.startsWith("Device.Hosts") && !c.path.startsWith("Device.WiFi")), false);
});

test("jendela: dalam sehari yang sama nilainya tetap (tidak mengambil ulang), hari berikutnya berubah", () => {
  const t = 1_760_000_000_000;
  const at = (n) => run(n).find((x) => x.path === "InternetGatewayDevice.DeviceInfo.*").ts.path;
  assert.equal(at(t), at(t + 3_600_000));
  assert.ok(at(t + 2 * 86_400_000) > at(t));
});

test("data cepat berubah diambil real-time dan tidak membaca kata sandi", () => {
  const calls = run();
  const host = calls.find((x) => x.path === "InternetGatewayDevice.LANDevice.*.Hosts.Host.*.*");
  assert.ok(host);
  assert.equal(host.ts.value, 1_760_000_000_000);
  for (const c of calls) assert.doesNotMatch(c.path, /(Password|KeyPassphrase|PreSharedKey)/i);
});

test("preset noc-full menunjuk provision yang ada dan berlaku di setiap sesi", () => {
  assert.equal(preset.configurations[0].type, "provision");
  assert.equal(preset.configurations[0].name, "noc-full");
  assert.deepEqual(preset.events, {});
  assert.equal(preset.precondition, "");
});

test("virtual parameter dihitung dan disimpan seketika secara real-time, SESUDAH pembacaan data", () => {
  const calls = run();
  const i = calls.findIndex((c) => c.path === "VirtualParameters.*");
  assert.ok(i > 0, "provision harus meminta VirtualParameters.*");
  assert.equal(i, calls.length - 1, "harus yang terakhir, supaya data sumbernya sudah dibaca");
  assert.equal(calls[i].ts.value, 1_760_000_000_000);
});
