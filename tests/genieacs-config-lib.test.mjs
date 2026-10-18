import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { flattenUi, quoteLiteral } from "../scripts/genieacs-config-lib.mjs";

const read = (p) => readFileSync(new URL(`../docker/genieacs/config/${p}`, import.meta.url), "utf8");
const ui = JSON.parse(read("ui.json"));
const map = (docs) => Object.fromEntries(docs.map((d) => [d._id, d.value]));

test("quoteLiteral meng-escape kutip dan backslash", () => {
  assert.equal(quoteLiteral("PON"), "'PON'");
  assert.equal(quoteLiteral("it's"), "'it\\'s'");
  assert.equal(quoteLiteral("a\\b"), "'a\\\\b'");
});

test("flattenUi: parameter apa adanya, label dikutip, boolean teks, array berindeks", () => {
  const { docs, prefixes } = flattenUi({
    _catatan: "diabaikan",
    "ui.index": [
      { label: "PON", parameter: "VirtualParameters.ponType" },
      { label: "Tags", type: "tags", parameter: "Tags", unsortable: true },
      { label: "Inform", type: "container", components: [{ type: "parameter" }, "Teks"], parameters: ["A.*", "B.C"] },
    ],
  });
  const m = map(docs);
  assert.deepEqual(prefixes, ["ui.index"]);
  assert.equal(m["ui.index.0.label"], "'PON'");
  assert.equal(m["ui.index.0.parameter"], "VirtualParameters.ponType");
  assert.equal(m["ui.index.1.unsortable"], "true");
  assert.equal(m["ui.index.2.components.0.type"], "'parameter'");
  assert.equal(m["ui.index.2.components.1"], "'Teks'");
  assert.equal(m["ui.index.2.parameters.0"], "A.*");
  assert.equal(m["ui.index.2.parameters.1"], "B.C");
  assert.equal(Object.keys(m).some((k) => k.includes("_catatan")), false);
});

test("flattenUi menolak kunci tingkat atas dan nilai yang tidak sah", () => {
  assert.throws(() => flattenUi({ "ui.index; drop": [] }));
  assert.throws(() => flattenUi({ "ui.index": [{ a: null }] }));
});

test("ui.json nyata: kolom Devices memakai virtual parameter yang ADA di repo", () => {
  const vparams = new Set(readdirSync(new URL("../docker/genieacs/config/virtual_parameters/", import.meta.url)).map((f) => f.slice(0, -3)));
  const { docs } = flattenUi(ui);
  const used = new Set();
  for (const d of docs) {
    for (const m of d.value.matchAll(/VirtualParameters\.([A-Za-z0-9_]+)/g)) used.add(m[1]);
  }
  assert.ok(used.size >= 10, "kolom penting harus memakai virtual parameter");
  for (const u of used) assert.ok(vparams.has(u), `virtual parameter tidak ada di repo: ${u}`);
  const m = map(docs);
  const labels = Object.entries(m).filter(([k]) => /^ui\.index\.\d+\.label$/.test(k)).map(([, v]) => v);
  for (const want of ["'PON'", "'SSID'", "'Active'", "'IP PPPoE'", "'IP WAN/TR069'", "'SN ONT'", "'Mac'", "'Uptime'"]) {
    assert.ok(labels.includes(want), `kolom hilang: ${want}`);
  }
});

test("ui.json tidak menunjuk parameter yang tidak ada di modem ini (WANIPConnection bawaan)", () => {
  const { docs } = flattenUi(ui);
  for (const d of docs) assert.doesNotMatch(d.value, /WANIPConnection\.1\./, d._id);
});

// --- virtual parameter dijalankan terhadap data modem FD511GW nyata (nilai non-rahasia) ---
const FD511GW = {
  "InternetGatewayDevice.DeviceInfo.SerialNumber": "DF77-2511027460",
  "InternetGatewayDevice.DeviceInfo.UpTime": 120581,
  "InternetGatewayDevice.DeviceInfo.XponInterface.RXPower": "-18.297326  dBm",
  "InternetGatewayDevice.DeviceInfo.XponInterface.TXPower": "1.866212  dBm",
  "InternetGatewayDevice.DeviceInfo.XponInterface.TransceiverTemperature": 37.292969,
  "InternetGatewayDevice.ManagementServer.ConnectionRequestURL": "http://172.16.15.239:7547/tr069",
  "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username": "17060001824@runsnet.id",
  "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress": "172.16.15.239",
  "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.MACAddress": "d0:5f:af:d3:c7:1f",
  "InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.Status": "Up",
  "InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress": "D0:5F:AF:D3:C7:1E",
  "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID": "PEMDES",
  // Nyata di FD511GW: klien Wi-Fi tetap berflag Active=false, jumlahnya ada di TotalAssociations.
  "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations": 5,
  "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.TotalAssociations": 0,
  "InternetGatewayDevice.LANDevice.1.Hosts.Host.1.Active": false,
  "InternetGatewayDevice.LANDevice.1.Hosts.Host.1.InterfaceType": "802.11",
  "InternetGatewayDevice.LANDevice.1.Hosts.Host.2.Active": true,
  "InternetGatewayDevice.LANDevice.1.Hosts.Host.2.InterfaceType": "Ethernet",
  "InternetGatewayDevice.LANDevice.1.Hosts.Host.3.Active": true,
  "InternetGatewayDevice.LANDevice.1.Hosts.Host.3.InterfaceType": "802.11",
};

// declare() tiruan: pola dengan "*" memadai segmen angka/nama mana pun.
function runVParam(name, params) {
  const script = read(`virtual_parameters/${name}.js`);
  const declare = (pattern) => {
    const re = new RegExp("^" + pattern.split(".").map((s) => (s === "*" ? "[^.]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("\\.") + "$");
    return Object.entries(params)
      .filter(([k]) => re.test(k))
      .map(([k, v]) => ({ path: k, value: [v] }));
  };
  return vm.runInNewContext(`(function(){${script}})()`, { declare, parseFloat, Math, Number, String, isFinite, RegExp }, { timeout: 1000 });
}
const v = (name, params = FD511GW) => runVParam(name, params).value[0];

test("virtual parameter: nilai untuk FD511GW nyata", () => {
  assert.equal(v("ponType"), "EPON");
  assert.equal(v("pppoeUsername"), "17060001824@runsnet.id");
  assert.equal(v("ssid"), "PEMDES");
  assert.equal(v("activeDevices"), 6, "5 klien Wi-Fi + 1 host kabel aktif; Wi-Fi Active=true tidak dihitung dua kali");
  assert.equal(v("rxPower"), "-18.3");
  assert.equal(v("txPower"), "1.87");
  assert.equal(v("temperature"), "37.29");
  assert.equal(v("uptime"), "1d 09:29:41");
  assert.equal(v("ipPppoe"), "172.16.15.239");
  assert.equal(v("ipTr069"), "172.16.15.239");
  assert.equal(v("snOnt"), "DF77-2511027460");
  assert.equal(v("mac"), "d0:5f:af:d3:c7:1e");
});

// Daftar tipe yang DITERIMA GenieACS 1.2.13 untuk virtual parameter (dibaca dari kodenya).
// xsd:double tidak ada: skrip yang memakainya membuat fault "Invalid virtual parameter value attribute".
const ALLOWED_TYPES = new Set(["xsd:int", "xsd:unsignedInt", "xsd:boolean", "xsd:string", "xsd:dateTime", "xsd:base64", "xsd:hexBinary"]);

test("virtual parameter: semua tipe nilai termasuk yang diterima GenieACS, nilai tidak null", () => {
  for (const name of readdirSync(new URL("../docker/genieacs/config/virtual_parameters/", import.meta.url)).map((f) => f.slice(0, -3))) {
    for (const params of [FD511GW, {}]) {
      const r = runVParam(name, params);
      assert.ok(ALLOWED_TYPES.has(r.value[1]), `${name}: tipe ${r.value[1]}`);
      assert.notEqual(r.value[0], null, name);
      assert.notEqual(r.value[0], undefined, name);
    }
  }
  assert.equal(runVParam("activeDevices", FD511GW).value[1], "xsd:int");
});

test("virtual parameter: modem tanpa data menghasilkan nilai kosong, bukan galat", () => {
  for (const name of readdirSync(new URL("../docker/genieacs/config/virtual_parameters/", import.meta.url)).map((f) => f.slice(0, -3))) {
    const r = runVParam(name, {});
    assert.equal(r.writable, false, name);
    assert.ok(r.value[0] === "" || r.value[0] === 0, `${name}: ${r.value[0]}`);
  }
});

test("virtual parameter: cadangan dari nilai mentah EPON (0,1 uW dan 1/256 C)", () => {
  const raw = {
    "InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower": 148,
    "InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.TXPower": 15254,
    "InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.TransceiverTemperature": 9456,
  };
  assert.equal(v("rxPower", raw), "-18.3");
  assert.equal(v("txPower", raw), "1.83");
  assert.equal(v("temperature", raw), "36.94");
});

test("virtual parameter: IP PPPoE melewati 0.0.0.0, uptime tepat di batas hari", () => {
  const p = {
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress": "0.0.0.0",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.2.ExternalIPAddress": "10.1.2.3",
    "InternetGatewayDevice.DeviceInfo.UpTime": 86400,
  };
  assert.equal(v("ipPppoe", p), "10.1.2.3");
  assert.equal(v("uptime", p), "1d 00:00:00");
});

test("virtual parameter hanya membaca: tanpa nilai ketiga di declare dan tanpa penulisan", () => {
  for (const f of readdirSync(new URL("../docker/genieacs/config/virtual_parameters/", import.meta.url))) {
    const s = read(`virtual_parameters/${f}`);
    assert.doesNotMatch(s, /declare\([^)]*\)\s*,\s*\{value:/);
    assert.match(s, /writable:\s*false/, f);
  }
});
