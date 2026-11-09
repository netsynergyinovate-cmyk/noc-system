import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const script = readFileSync(
  new URL(
    "../docker/genieacs/config/provisions/noc-vital-refresh.js",
    import.meta.url,
  ),
  "utf8",
);
const preset = JSON.parse(
  readFileSync(
    new URL(
      "../docker/genieacs/config/presets/02-periodic-inform.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function run(now = 1_760_000_000_000) {
  const calls = [];
  const sandbox = {
    declare: (path, ts) => {
      calls.push({ path, ts });
      return [];
    },
    Date: { now: () => now },
  };
  vm.runInNewContext(script, sandbox, { timeout: 1000 });
  return calls;
}

test("noc-vital-refresh valid dan hanya membaca leaf parameter vital (tanpa tree crawl liar)", () => {
  assert.doesNotThrow(() => new vm.Script(script));
  const calls = run();
  assert.ok(calls.length > 0);

  // Tidak boleh membaca password
  for (const c of calls) {
    assert.doesNotMatch(c.path, /(Password|KeyPassphrase|PreSharedKey)/i);
  }

  // Parameter optik, host, SSID, IP WAN & TR-069 harus ada
  assert.ok(
    calls.some(
      (c) =>
        c.path.includes("OpticalSignalLevel") || c.path.includes("RXPower"),
    ),
  );
  assert.ok(calls.some((c) => c.path.includes("Hosts.Host")));
  assert.ok(calls.some((c) => c.path.includes("SSID")));
  assert.ok(calls.some((c) => c.path.includes("ConnectionRequestURL")));
  assert.ok(
    calls.some(
      (c) =>
        c.path.includes("ExternalIPAddress") ||
        c.path.includes("LocalIPAddress"),
    ),
  );

  // Virtual parameters dihitung di akhir
  const last = calls[calls.length - 1];
  assert.equal(last.path, "VirtualParameters.*");
});

test("preset 02-periodic-inform menunjuk provision noc-vital-refresh pada channel terpisah", () => {
  assert.equal(preset.configurations[0].type, "provision");
  assert.equal(preset.configurations[0].name, "noc-vital-refresh");
  assert.equal(preset.channel, "noc-vital");
  assert.deepEqual(preset.events, {});
});
