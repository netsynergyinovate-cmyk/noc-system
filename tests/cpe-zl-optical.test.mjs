import test from "node:test";
import assert from "node:assert/strict";
import { mapGenieAcsToCpe } from "../src/lib/genieacs/client.ts";
import { parseDeviceDetail } from "../src/lib/genieacs/device-detail.ts";

// Struktur NBI bersarang dari path datar.
function nbi(flat, meta = {}) {
  const root = { ...meta };
  for (const [path, value] of Object.entries(flat)) {
    let node = root;
    const keys = path.split(".");
    keys.forEach((k, i) => {
      node[k] = node[k] ?? { _object: i < keys.length - 1 };
      node = node[k];
    });
    node._value = value;
    node._object = false;
  }
  return root;
}

const P = "InternetGatewayDevice";
const EPON = `${P}.WANDevice.1.X_CT-COM_EponInterfaceConfig`;

// ZIMLINK ZL-2113X nyata (HWTC): optik hanya ada sebagai satuan MENTAH di X_CT-COM_EponInterfaceConfig,
// identitas ada di "_deviceId", dan tidak ada sensor suhu terpisah.
function zl(over = {}) {
  return nbi(
    {
      [`${EPON}.Status`]: "Up",
      [`${EPON}.RXPower`]: 83,
      [`${EPON}.TXPower`]: 13560,
      [`${EPON}.TransceiverTemperature`]: 10957,
      [`${EPON}.BiasCurrent`]: 4945,
      [`${EPON}.SupplyVottage`]: 32671,
      [`${P}.DeviceInfo.ProcessStatus.CPUUsage`]: 3,
      [`${P}.DeviceInfo.UpTime`]: 81346,
      ...over,
    },
    {
      _id: "HWTC-ZL%2D2113X-HWTCA903DC60",
      _lastInform: "2026-10-15T08:57:09.679Z",
      _deviceId: {
        _Manufacturer: "HWTC",
        _OUI: "HWTC",
        _ProductClass: "ZL-2113X",
        _SerialNumber: "HWTCA903DC60",
      },
    },
  );
}

test("tabel: optik ZL-2113X dari satuan mentah, cocok dengan bacaan OLT untuk ONU yang sama", () => {
  const c = mapGenieAcsToCpe(zl());
  assert.deepEqual(
    { ...c.optical },
    {
      rxDbm: -20.81,
      txDbm: 1.32,
      biasMa: 4.95,
      voltageV: 3.27,
      temperatureC: 42.8,
    },
  );
  assert.equal(
    c.opticalPowerDbm,
    -20.81,
    "RX lama yang dipakai di banyak tempat ikut benar",
  );
  assert.equal(c.productClass, "ZL-2113X");
});

test("tabel: suhu modul optik dipakai bila tidak ada sensor suhu terpisah", () => {
  const c = mapGenieAcsToCpe(zl());
  assert.deepEqual(
    c.health.temperatures.map((t) => [t.name, t.celsius]),
    [["Modul optik", 42.8]],
  );
  const withSensor = mapGenieAcsToCpe(
    zl({
      [`${P}.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Name`]: "SoC",
      [`${P}.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value`]: 73,
    }),
  );
  assert.deepEqual(
    withSensor.health.temperatures.map((t) => t.name),
    ["SoC"],
    "sensor sungguhan menang; tidak dobel",
  );
});

test("tabel: tanpa sinyal (RX 0) menjadi null, bukan -infinity atau karangan", () => {
  const c = mapGenieAcsToCpe(
    zl({
      [`${EPON}.RXPower`]: 0,
      [`${EPON}.TXPower`]: 0,
      [`${EPON}.TransceiverTemperature`]: 0,
    }),
  );
  assert.equal(c.optical.rxDbm, null);
  assert.equal(c.optical.txDbm, null);
  assert.equal(c.optical.temperatureC, null);
  assert.equal(c.health.temperatures.length, 0);
});

test("tabel: format lain (X_ALU dan XponInterface) tetap didahulukan", () => {
  const alu = mapGenieAcsToCpe(
    zl({
      [`${P}.X_ALU_OntOpticalParam.RXPower`]: "-18.5 dBm",
      [`${P}.X_ALU_OntOpticalParam.TXPower`]: "2.1 dBm",
    }),
  );
  assert.equal(alu.optical.rxDbm, -18.5, "satuan mentah hanya cadangan");
  const xpon = mapGenieAcsToCpe(
    zl({
      [`${P}.DeviceInfo.XponInterface.RXPower`]: "-19.2  dBm",
      [`${P}.DeviceInfo.XponInterface.TXPower`]: "1.5  dBm",
    }),
  );
  assert.equal(xpon.optical.rxDbm, -19.2);
});

test("rincian: identitas dibaca dari _deviceId (model dan OUI tidak kosong)", () => {
  const d = parseDeviceDetail(zl());
  assert.equal(d.productClass, "ZL-2113X");
  assert.equal(d.oui, "HWTC");
  assert.equal(d.manufacturer, "HWTC");
  assert.equal(d.serialNumber, "HWTCA903DC60");
});

test("rincian: redaman = TX - RX dan suhu kesehatan tidak kosong", () => {
  const d = parseDeviceDetail(zl());
  assert.equal(d.optical.rxDbm, -20.81);
  assert.equal(d.optical.txDbm, 1.32);
  assert.equal(d.optical.lossDb, 22.13);
  assert.deepEqual(
    d.health.temperatures.map((t) => [t.name, t.celsius]),
    [["Modul optik", 42.8]],
  );
  const none = parseDeviceDetail(zl({ [`${EPON}.RXPower`]: 0 }));
  assert.equal(
    none.optical.lossDb,
    null,
    "tanpa RX tidak ada redaman yang bisa dihitung",
  );
});
