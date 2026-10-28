import test from "node:test";
import assert from "node:assert/strict";
import { hasNode, parseDeviceDetail, parseDeviceSecrets, readParam } from "../src/lib/genieacs/device-detail.ts";
import { deviceIdCandidates, getCpeDetail, getCpeSecrets, refreshCpeRealtime } from "../src/services/cpe-detail.service.ts";

// Membangun struktur NBI bersarang dari path datar: { "A.B": 1 } -> {A:{B:{_value:1}}}
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
const DEVICE = nbi(
  {
    [`${P}.DeviceInfo.SerialNumber`]: "DF77-2511027460",
    [`${P}.DeviceInfo.Manufacturer`]: "CDTC",
    [`${P}.DeviceInfo.HardwareVersion`]: "V2.0",
    [`${P}.DeviceInfo.SoftwareVersion`]: "V1.0.5",
    [`${P}.DeviceInfo.UpTime`]: 120581,
    [`${P}.DeviceInfo.XponInterface.RXPower`]: "-18.297326  dBm",
    [`${P}.DeviceInfo.XponInterface.TXPower`]: "1.866212  dBm",
    [`${P}.DeviceInfo.XponInterface.TransceiverTemperature`]: 37.292969,
    [`${P}.DeviceInfo.ProcessStatus.CPUUsage`]: 12,
    [`${P}.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Name`]: "SoC",
    [`${P}.DeviceInfo.TemperatureStatus.TemperatureSensor.1.Value`]: 73,
    [`${P}.DeviceInfo.TemperatureStatus.TemperatureSensor.2.Name`]: "Optical Module",
    [`${P}.DeviceInfo.TemperatureStatus.TemperatureSensor.2.Value`]: 38,
    [`${P}.ManagementServer.URL`]: "http://172.16.0.1:7547",
    [`${P}.ManagementServer.Username`]: "admin",
    [`${P}.ManagementServer.Password`]: "",
    [`${P}.ManagementServer.PeriodicInformEnable`]: true,
    [`${P}.ManagementServer.PeriodicInformInterval`]: 300,
    [`${P}.ManagementServer.ConnectionRequestURL`]: "http://172.16.15.239:7547/tr069",
    [`${P}.WANDevice.1.X_CT-COM_EponInterfaceConfig.Status`]: "Up",
    [`${P}.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Name`]: "1_TR069_INTERNET_R_VID_",
    [`${P}.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username`]: "17060001824@runsnet.id",
    [`${P}.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Password`]: "",
    [`${P}.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress`]: "172.16.15.239",
    [`${P}.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.MACAddress`]: "d0:5f:af:d3:c7:1f",
    [`${P}.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ConnectionStatus`]: "Connected",
    [`${P}.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress`]: "D0:5F:AF:D3:C7:1E",
    [`${P}.LANDevice.1.WLANConfiguration.1.SSID`]: "PEMDES TUNGGAL JAYA",
    [`${P}.LANDevice.1.WLANConfiguration.1.Enable`]: true,
    [`${P}.LANDevice.1.WLANConfiguration.1.Channel`]: 6,
    [`${P}.LANDevice.1.WLANConfiguration.1.TotalAssociations`]: 17,
    [`${P}.LANDevice.1.WLANConfiguration.1.KeyPassphrase`]: "",
    [`${P}.LANDevice.1.WLANConfiguration.1.X_CMS_KeyPassphrase`]: "WIFI-RAHASIA-1",
    [`${P}.LANDevice.1.WLANConfiguration.2.SSID`]: "HGW-D3C71D-1",
    [`${P}.LANDevice.1.WLANConfiguration.2.Enable`]: false,
    [`${P}.LANDevice.1.WLANConfiguration.2.TotalAssociations`]: 0,
    [`${P}.LANDevice.1.WLANConfiguration.2.KeyPassphrase`]: "",
    [`${P}.LANDevice.1.WLANConfiguration.2.X_CMS_KeyPassphrase`]: "",
    [`${P}.LANDevice.1.Hosts.Host.1.HostName`]: "DESKTOP-ABC",
    [`${P}.LANDevice.1.Hosts.Host.1.IPAddress`]: "192.168.101.15",
    [`${P}.LANDevice.1.Hosts.Host.1.MACAddress`]: "C0:BF:BE:7C:07:F6",
    [`${P}.LANDevice.1.Hosts.Host.1.InterfaceType`]: "802.11",
    [`${P}.LANDevice.1.Hosts.Host.1.Active`]: false,
    [`${P}.LANDevice.1.Hosts.Host.2.HostName`]: "PC-KABEL",
    [`${P}.LANDevice.1.Hosts.Host.2.InterfaceType`]: "Ethernet",
    [`${P}.LANDevice.1.Hosts.Host.2.Active`]: true,
    [`${P}.X_Authentication.WebAccount.UserName`]: "webadmin",
    [`${P}.X_Authentication.WebAccount.Password`]: "WEB-RAHASIA-2",
    [`${P}.X_CT-COM_UserInfo.UserName`]: "telecomuser1",
    [`${P}.X_CT-COM_UserInfo.Password`]: "TELECOM-RAHASIA-3",
    [`${P}.X_Authentication.Account.UserName`]: "admin",
    [`${P}.X_Authentication.Account.ModifyPassword`]: "admin",
  },
  {
    _id: "D05FAF-FD511GW-DF77%2D2511027460",
    _lastInform: "2026-10-15T05:24:12.938Z",
    _registered: "2026-10-15T05:04:10.750Z",
    DeviceID: { _ProductClass: "FD511GW", _OUI: "D05FAF", _SerialNumber: "DF77-2511027460", _Manufacturer: "CDTC" },
  },
);

test("rincian: identitas, jaringan dan optik dibaca dari data NBI", () => {
  const d = parseDeviceDetail(DEVICE);
  assert.equal(d.deviceId, "D05FAF-FD511GW-DF77%2D2511027460");
  assert.equal(d.serialNumber, "DF77-2511027460");
  assert.equal(d.productClass, "FD511GW");
  assert.equal(d.oui, "D05FAF");
  assert.equal(d.ponType, "EPON");
  assert.equal(d.pppoeUsername, "17060001824@runsnet.id");
  assert.equal(d.wanIp, "172.16.15.239");
  assert.equal(d.tr069Ip, "172.16.15.239");
  assert.equal(d.macAddress, "d0:5f:af:d3:c7:1e");
  assert.equal(d.uptimeSeconds, 120581);
  assert.deepEqual({ ...d.optical }, { rxDbm: -18.297326, txDbm: 1.866212, lossDb: 20.16, temperatureC: 37.292969, biasMa: null, voltageV: null });
  assert.equal(d.health.cpuPercent, 12);
  assert.deepEqual(d.health.temperatures.map((t) => [t.name, t.celsius]), [["SoC", 73], ["Optical Module", 38]]);
  assert.equal(d.acs.url, "http://172.16.0.1:7547");
  assert.equal(d.acs.informInterval, 300);
  assert.equal(d.acs.informEnabled, true);
});

test("rincian: WAN, Wi-Fi dan host; 'Active' Wi-Fi dihitung dari TotalAssociations", () => {
  const d = parseDeviceDetail(DEVICE);
  assert.equal(d.wans.length, 1);
  assert.equal(d.wans[0].kind, "PPPoE");
  assert.equal(d.wans[0].status, "Connected");
  assert.equal(d.wlans.length, 2);
  assert.deepEqual(d.wlans.map((w) => [w.index, w.ssid, w.enabled, w.clients, w.hasPassphrase]), [
    [1, "PEMDES TUNGGAL JAYA", true, 17, true],
    [2, "HGW-D3C71D-1", false, 0, false],
  ]);
  assert.equal(d.hosts.length, 2);
  assert.equal(d.hosts[0].mac, "c0:bf:be:7c:07:f6");
  assert.equal(d.activeClients, 18, "17 klien Wi-Fi + 1 host kabel aktif; flag Active Wi-Fi tidak dipercaya");
});

test("rincian TIDAK memuat sandi apa pun, hanya penanda hasPassphrase", () => {
  const json = JSON.stringify(parseDeviceDetail(DEVICE));
  for (const secret of ["WIFI-RAHASIA-1", "WEB-RAHASIA-2", "TELECOM-RAHASIA-3", "webadmin", "telecomuser1"]) {
    assert.equal(json.includes(secret), false, `bocor: ${secret}`);
  }
});

test("sandi: akun web modem dan Wi-Fi dibaca dari parameter vendor", () => {
  const s = parseDeviceSecrets(DEVICE);
  const web = s.accounts.find((a) => a.source === "X_Authentication.WebAccount");
  assert.deepEqual({ u: web.username, p: web.password, used: web.usedByApp }, { u: "webadmin", p: "WEB-RAHASIA-2", used: true });
  const tel = s.accounts.find((a) => a.source === "X_CT-COM_UserInfo");
  assert.equal(tel.password, "TELECOM-RAHASIA-3");
  assert.equal(tel.usedByApp, false);
  assert.deepEqual(s.wifi, [{ index: 1, ssid: "PEMDES TUNGGAL JAYA", passphrase: "WIFI-RAHASIA-1" }]);
});

test("sandi: KeyPassphrase standar dipakai bila parameter vendor tidak ada; kosong tidak ditampilkan", () => {
  const dev = nbi({
    [`${P}.LANDevice.1.WLANConfiguration.1.SSID`]: "A",
    [`${P}.LANDevice.1.WLANConfiguration.1.KeyPassphrase`]: "STANDAR-PASS",
    [`${P}.LANDevice.1.WLANConfiguration.2.SSID`]: "B",
    [`${P}.LANDevice.1.WLANConfiguration.2.KeyPassphrase`]: "",
  });
  assert.deepEqual(parseDeviceSecrets(dev).wifi, [{ index: 1, ssid: "A", passphrase: "STANDAR-PASS" }]);
});

test("data kosong atau bukan objek tidak membuat galat", () => {
  for (const raw of [null, undefined, {}, [], "x", 5]) {
    const d = parseDeviceDetail(raw);
    assert.equal(d.wans.length, 0);
    assert.equal(d.optical.rxDbm, null);
    assert.deepEqual(parseDeviceSecrets(raw), { accounts: [], wifi: [] });
  }
  assert.equal(readParam(null, "A.B"), undefined);
});

test("cadangan optik dari nilai mentah EPON (0,1 uW dan 1/256 C)", () => {
  const dev = nbi({
    [`${P}.WANDevice.1.X_CT-COM_EponInterfaceConfig.Status`]: "Up",
    [`${P}.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower`]: 148,
    [`${P}.WANDevice.1.X_CT-COM_EponInterfaceConfig.TXPower`]: 15254,
    [`${P}.WANDevice.1.X_CT-COM_EponInterfaceConfig.TransceiverTemperature`]: 9456,
    [`${P}.WANDevice.1.X_CT-COM_EponInterfaceConfig.BiasCurrent`]: 5500,
    [`${P}.WANDevice.1.X_CT-COM_EponInterfaceConfig.SupplyVottage`]: 32682,
  });
  const o = parseDeviceDetail(dev).optical;
  assert.equal(o.rxDbm, -18.3);
  assert.equal(o.txDbm, 1.83);
  assert.equal(o.temperatureC, 36.94);
  assert.equal(o.biasMa, 5.5);
  assert.equal(o.voltageV, 3.27);
});

test("id GenieACS dengan '%2D': coba apa adanya dulu, lalu hasil decode", () => {
  assert.deepEqual(deviceIdCandidates("D05FAF-FD511GW-DF77%2D2511027460"), [
    "D05FAF-FD511GW-DF77%2D2511027460",
    "D05FAF-FD511GW-DF77-2511027460",
  ]);
  assert.deepEqual(deviceIdCandidates("polos"), ["polos"]);
  assert.deepEqual(deviceIdCandidates("%E0%A4%A"), ["%E0%A4%A"], "escape rusak tidak melempar galat");
});

test("layanan: id ditemukan di kandidat mana pun, sandi hanya lewat getCpeSecrets", async () => {
  const asked = [];
  const client = {
    async getRawDevice(id) {
      asked.push(id);
      return id === "D05FAF-FD511GW-DF77%2D2511027460" ? DEVICE : null;
    },
  };
  const detail = await getCpeDetail("D05FAF-FD511GW-DF77%2D2511027460", client);
  assert.equal(detail.serialNumber, "DF77-2511027460");
  assert.equal(JSON.stringify(detail).includes("WEB-RAHASIA-2"), false);
  // Klien yang meng-encode dua kali: server menerima "%252D" -> Next men-decode jadi "%2D"; di sini
  // dicoba juga bentuk yang di-decode lagi, dan sebaliknya.
  const found = await getCpeSecrets("D05FAF-FD511GW-DF77%2D2511027460", client);
  assert.equal(found.deviceId, "D05FAF-FD511GW-DF77%2D2511027460");
  assert.equal(found.secrets.accounts[0].password, "WEB-RAHASIA-2");
  assert.equal(await getCpeDetail("tidak-ada", { async getRawDevice() { return null; } }), null);
  assert.equal(await getCpeSecrets("tidak-ada", { async getRawDevice() { return null; } }), null);
});

import { getCpeDevice } from "../src/services/cpe-devices.service.ts";

test("getCpeDevice: id dengan '%2D' ditemukan apa adanya, dan bentuk ter-decode dicoba sesudahnya", async () => {
  const asked = [];
  const found = { deviceId: "ok" };
  const client = {
    async getDevice(id) {
      asked.push(id);
      return id === "D05FAF-FD511GW-DF77%2D2511027460" ? found : null;
    },
  };
  assert.equal(await getCpeDevice("D05FAF-FD511GW-DF77%2D2511027460", client), found);
  assert.deepEqual(asked, ["D05FAF-FD511GW-DF77%2D2511027460"], "ketemu pada percobaan pertama");

  asked.length = 0;
  const viaDecode = { async getDevice(id) { asked.push(id); return id === "A-B-C" ? found : null; } };
  assert.equal(await getCpeDevice("A%2DB-C", viaDecode), found);
  assert.deepEqual(asked, ["A%2DB-C", "A-B-C"]);
  assert.equal(await getCpeDevice("x", { async getDevice() { return null; } }), null);
});
test("hasNode: mendeteksi keberadaan objek/cabang NBI yang tidak memiliki _value", () => {
  assert.equal(hasNode(DEVICE, "InternetGatewayDevice.LANDevice.1.Hosts"), true);
  assert.equal(readParam(DEVICE, "InternetGatewayDevice.LANDevice.1.Hosts"), undefined, "readParam hanya untuk leaf parameter");
  assert.equal(hasNode(DEVICE, "InternetGatewayDevice.TidakAda"), false);
});

test("refreshCpeRealtime: hanya meminta parameter & objek yang benar-benar ada di pohon modem", async () => {
  const postedTasks = [];
  const deletedTasks = [];

  const mockClient = {
    async getRawDevice(id) {
      return id === "D05FAF-FD511GW-DF77%2D2511027460" ? DEVICE : null;
    },
    async postTask(id, task, cr, timeout) {
      postedTasks.push({ id, task, cr, timeout });
      return { ok: true, status: 200, taskId: "task-123" };
    },
    async deleteTask(taskId) {
      deletedTasks.push(taskId);
      return true;
    },
  };

  const res = await refreshCpeRealtime("D05FAF-FD511GW-DF77%2D2511027460", mockClient);
  assert.equal(res.ok, true);
  assert.equal(res.refreshed, true);
  assert.equal(res.status, 200);

  // Verifikasi task getParameterValues hanya berisi parameter leaf yang ADA di DEVICE fixture
  const gpv = postedTasks.find((p) => p.task.name === "getParameterValues");
  assert.ok(gpv);
  assert.deepEqual(gpv.task.parameterNames, [
    "InternetGatewayDevice.DeviceInfo.XponInterface.RXPower",
    "InternetGatewayDevice.DeviceInfo.XponInterface.TXPower",
    "InternetGatewayDevice.DeviceInfo.XponInterface.TransceiverTemperature",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations",
    "InternetGatewayDevice.DeviceInfo.UpTime",
  ]);
  // Memastikan cabang vendor yang tidak ada (X_ALU) tidak ikut diminta
  assert.equal(gpv.task.parameterNames.some((p) => p.includes("X_ALU")), false);

  // Verifikasi refreshObject diarahkan ke Hosts.Host yang ada
  const ro = postedTasks.find((p) => p.task.name === "refreshObject");
  assert.ok(ro);
  assert.equal(ro.task.objectName, "InternetGatewayDevice.LANDevice.1.Hosts.Host");
});

test("refreshCpeRealtime: bila status 202 (queued), task dibatalkan dan refreshed bernilai false", async () => {
  const deletedTasks = [];
  const mockClient = {
    async getRawDevice() {
      return DEVICE;
    },
    async postTask() {
      return { ok: true, status: 202, taskId: "queued-task-456" };
    },
    async deleteTask(taskId) {
      deletedTasks.push(taskId);
      return true;
    },
  };

  const res = await refreshCpeRealtime("D05FAF-FD511GW-DF77%2D2511027460", mockClient);
  assert.equal(res.refreshed, false);
  assert.equal(res.status, 202);
  assert.ok(deletedTasks.includes("queued-task-456"), "task 202 harus dibersihkan dari antrean GenieACS");
});
