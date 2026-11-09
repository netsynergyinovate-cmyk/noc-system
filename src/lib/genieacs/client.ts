// Klien baca GenieACS NBI. Dua mode: "real" (HTTP ke NBI) dan "simulator"
// (data tiruan deterministik). Murni (tanpa alias path) agar bisa diuji dengan node --test.

import { formatUptime } from "../dashboard/cpe.ts";
import type {
  CpeDevice,
  CpeHealth,
  CpeHostClient,
  CpeInterfaceType,
  CpeOptical,
  CpeTemperatureSensor,
} from "../dashboard/cpe.ts";
import { getGenieacsConfig } from "./config.ts";
import type { GenieAcsConfig } from "./config.ts";

export const SIMULATOR_DEVICE_COUNT = 0;
export const SIMULATOR_LATENCY_MS = 15;
/** Perangkat dianggap online bila inform terakhir tidak lebih lama dari ini. */
export const ONLINE_WINDOW_SECONDS = 15 * 60;

export class GenieAcsError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "GenieAcsError";
    this.status = status;
  }
}

function simulatorDevices(): CpeDevice[] {
  return [];
}

type Fetcher = typeof fetch;
type Raw = Record<string, unknown>;

// ---------- parser TR-098 / TR-181 ----------

const ROOTS = ["InternetGatewayDevice", "Device"] as const;

function isObj(v: unknown): v is Raw {
  return typeof v === "object" && v !== null;
}

/** Nilai parameter GenieACS: `{ _value }`, nilai polos, atau undefined. */
function unwrap(v: unknown): unknown {
  if (isObj(v)) return "_value" in v ? v._value : undefined;
  return v;
}

/** Baca path bertitik, baik dari objek bersarang maupun kunci datar ("A.B.C"). */
function read(raw: Raw, path: string): unknown {
  if (path in raw) return unwrap(raw[path]);
  let node: unknown = raw;
  for (const seg of path.split(".")) {
    if (!isObj(node) || !(seg in node)) return undefined;
    node = node[seg];
  }
  return unwrap(node);
}

/** Pembaca pertama yang ada nilainya di antara akar TR-098 dan TR-181. */
function readAny(raw: Raw, ...paths: string[]): unknown {
  for (const p of paths) {
    for (const root of ROOTS) {
      const v = read(raw, `${root}.${p}`);
      if (v !== undefined && v !== null && v !== "") return v;
    }
  }
  return undefined;
}

/** Indeks numerik anak dari sebuah prefix, urut naik. */
function indexes(raw: Raw, prefix: string): number[] {
  const set = new Set<number>();
  if (isObj(raw)) {
    let node: unknown = raw;
    for (const seg of prefix.split("."))
      node = isObj(node) ? node[seg] : undefined;
    if (isObj(node))
      for (const k of Object.keys(node))
        if (/^\d+$/.test(k)) set.add(Number(k));
    const flat = `${prefix}.`;
    for (const k of Object.keys(raw)) {
      if (k.startsWith(flat)) {
        const m = /^(\d+)(\.|$)/.exec(k.slice(flat.length));
        if (m) set.add(Number(m[1]));
      }
    }
  }
  return [...set].sort((a, b) => a - b);
}

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = str(v).toLowerCase();
  return s === "true" || s === "1" || s === "up" || s === "enabled";
}

function toEpochSeconds(v: unknown): number {
  if (v === undefined || v === null || v === "") return 0;
  if (typeof v === "number") return Math.floor(v > 1e11 ? v / 1000 : v);
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000);
}

function hostInterface(type: string, layer1: string): CpeInterfaceType {
  const t = `${type} ${layer1}`.toLowerCase();
  if (
    t.includes("802.11") ||
    t.includes("wifi") ||
    t.includes("wlan") ||
    t.includes("ssid")
  ) {
    return t.includes("5g") || t.includes("5ghz") ? "wifi_5g" : "wifi_2.4g";
  }
  return "ethernet";
}

function parseHosts(raw: Raw): CpeHostClient[] {
  const hosts: CpeHostClient[] = [];
  const associatedMacs = new Set<string>();

  // Klien Wi-Fi yang sedang berasosiasi (TR-098 & TR-181)
  const wlanBase = "InternetGatewayDevice.LANDevice.1.WLANConfiguration";
  for (const w of indexes(raw, wlanBase)) {
    const assocBase = `${wlanBase}.${w}.AssociatedDevice`;
    for (const a of indexes(raw, assocBase)) {
      const p = `${assocBase}.${a}`;
      const mac = (
        str(read(raw, `${p}.AssociatedDeviceMACAddress`)) ||
        str(read(raw, `${p}.MACAddress`))
      ).toLowerCase();
      if (
        mac &&
        !/^00:00:00:00:00:/i.test(mac) &&
        !/^00[:-]00[:-]00[:-]00[:-]00[:-]00$/i.test(mac)
      ) {
        associatedMacs.add(mac);
      }
    }
  }

  const bases = [
    "InternetGatewayDevice.LANDevice.1.Hosts.Host",
    "Device.Hosts.Host",
  ];
  for (const base of bases) {
    for (const i of indexes(raw, base)) {
      const p = `${base}.${i}`;
      const ip = str(read(raw, `${p}.IPAddress`));
      const mac = (
        str(read(raw, `${p}.MACAddress`)) || str(read(raw, `${p}.PhysAddress`))
      ).toLowerCase();
      if (
        (!ip && !mac) ||
        (mac &&
          (/^00:00:00:00:00:/i.test(mac) ||
            /^00[:-]00[:-]00[:-]00[:-]00[:-]00$/i.test(mac)))
      )
        continue;
      const activeRaw = read(raw, `${p}.Active`);
      const isActive =
        (mac && associatedMacs.has(mac)) ||
        (activeRaw === undefined ? true : bool(activeRaw));
      hosts.push({
        hostname: str(read(raw, `${p}.HostName`)) || "(tanpa nama)",
        ip,
        mac,
        interfaceType: hostInterface(
          str(read(raw, `${p}.InterfaceType`)),
          str(read(raw, `${p}.Layer1Interface`)),
        ),
        active: isActive,
      });
    }
  }
  return hosts;
}

function parseWifi(raw: Raw, hostCount: number): CpeDevice["wifi"] {
  const wifi: CpeDevice["wifi"] = {
    ssid: "",
    enabled: false,
    channel: 0,
    security: "",
    radioFrequency: "2.4GHz",
    clientCount: hostCount,
  };

  // TR-098: WLANConfiguration.N (N >= 5 lazimnya radio 5GHz).
  const tr098 = "InternetGatewayDevice.LANDevice.1.WLANConfiguration";
  const wlan = indexes(raw, tr098).find(
    (i) => str(read(raw, `${tr098}.${i}.SSID`)) !== "",
  );
  if (wlan !== undefined) {
    const p = `${tr098}.${wlan}`;
    wifi.ssid = str(read(raw, `${p}.SSID`));
    wifi.enabled = bool(read(raw, `${p}.Enable`));
    wifi.channel = num(read(raw, `${p}.Channel`)) ?? 0;
    wifi.security =
      str(read(raw, `${p}.BeaconType`)) ||
      str(read(raw, `${p}.WPAAuthenticationMode`));
    const band = str(read(raw, `${p}.OperatingFrequencyBand`));
    wifi.radioFrequency = band.startsWith("5") || wlan >= 5 ? "5GHz" : "2.4GHz";
    return wifi;
  }

  // TR-181: WiFi.SSID.N + WiFi.Radio.N.
  const ssidIdx = indexes(raw, "Device.WiFi.SSID").find(
    (i) => str(read(raw, `Device.WiFi.SSID.${i}.SSID`)) !== "",
  );
  if (ssidIdx !== undefined) {
    wifi.ssid = str(read(raw, `Device.WiFi.SSID.${ssidIdx}.SSID`));
    wifi.enabled = bool(read(raw, `Device.WiFi.SSID.${ssidIdx}.Enable`));
    const radio = indexes(raw, "Device.WiFi.Radio")[0];
    if (radio !== undefined) {
      const r = `Device.WiFi.Radio.${radio}`;
      wifi.channel = num(read(raw, `${r}.Channel`)) ?? 0;
      wifi.radioFrequency = str(
        read(raw, `${r}.OperatingFrequencyBand`),
      ).startsWith("5")
        ? "5GHz"
        : "2.4GHz";
    }
    const ap = indexes(raw, "Device.WiFi.AccessPoint")[0];
    if (ap !== undefined) {
      wifi.security = str(
        read(raw, `Device.WiFi.AccessPoint.${ap}.Security.ModeEnabled`),
      );
    }
  }
  return wifi;
}

function firstWanIp(raw: Raw): string {
  const tr098 = readTr098Wan(raw);
  if (tr098) return tr098;
  for (const i of indexes(raw, "Device.IP.Interface")) {
    for (const j of indexes(raw, `Device.IP.Interface.${i}.IPv4Address`)) {
      const ip = str(
        read(raw, `Device.IP.Interface.${i}.IPv4Address.${j}.IPAddress`),
      );
      if (ip && !ip.startsWith("127.") && !ip.startsWith("192.168.")) return ip;
    }
  }
  for (const i of indexes(raw, "Device.PPP.Interface")) {
    const ip = str(read(raw, `Device.PPP.Interface.${i}.IPCP.LocalIPAddress`));
    if (ip && ip !== "0.0.0.0") return ip;
  }
  const vPppoe = str(read(raw, "VirtualParameters.ipPppoe"));
  if (vPppoe && vPppoe !== "0.0.0.0") return vPppoe;
  const vTr069 = str(read(raw, "VirtualParameters.ipTr069"));
  if (vTr069 && vTr069 !== "0.0.0.0") return vTr069;
  const crUrl = str(readAny(raw, "ManagementServer.ConnectionRequestURL"));
  if (crUrl) {
    const m = /^https?:\/\/([^:\/]+)/i.exec(crUrl);
    if (m && m[1] && m[1] !== "0.0.0.0") return m[1];
  }
  return "";
}

function readTr098Wan(raw: Raw): string {
  const base = "InternetGatewayDevice.WANDevice.1.WANConnectionDevice";
  for (const i of indexes(raw, base)) {
    for (const kind of ["WANPPPConnection", "WANIPConnection"]) {
      for (const j of indexes(raw, `${base}.${i}.${kind}`)) {
        const ip = str(
          read(raw, `${base}.${i}.${kind}.${j}.ExternalIPAddress`),
        );
        if (ip && ip !== "0.0.0.0") return ip;
      }
    }
  }
  return "";
}

/** Username PPPoE modem: TR-098 WANPPPConnection atau TR-181 PPP.Interface. Kosong bila tidak ada. */
export function readPppoeUsername(raw: Raw): string {
  const base = "InternetGatewayDevice.WANDevice.1.WANConnectionDevice";
  for (const i of indexes(raw, base)) {
    for (const j of indexes(raw, `${base}.${i}.WANPPPConnection`)) {
      const u = str(read(raw, `${base}.${i}.WANPPPConnection.${j}.Username`));
      if (u) return u;
    }
  }
  for (const i of indexes(raw, "Device.PPP.Interface")) {
    const u = str(read(raw, `Device.PPP.Interface.${i}.Username`));
    if (u) return u;
  }
  return "";
}

/** Angka dari teks yang mungkin berekor satuan ("-20.457575  dBm", "11.800000 mA"). */
function numWithUnit(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const m = /-?\d+(?:\.\d+)?/.exec(String(v));
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Bacaan optik dari MODEM (GenieACS), bukan dari OLT. Hanya dikenali untuk merek
 * yang parameternya sudah diverifikasi di perangkat nyata (CDTC `X_ALU_OntOpticalParam`,
 * terbukti kembar dengan pembacaan OLT). Merek lain: semua null, bukan karangan.
 */
function parseOptical(raw: Raw): CpeOptical {
  const empty: CpeOptical = {
    rxDbm: null,
    txDbm: null,
    biasMa: null,
    voltageV: null,
    temperatureC: null,
  };
  for (const root of ROOTS) {
    const p = `${root}.X_ALU_OntOpticalParam`;
    const rx = numWithUnit(read(raw, `${p}.RXPower`));
    if (rx === null) continue;
    return {
      rxDbm: rx,
      txDbm: numWithUnit(read(raw, `${p}.TXPower`)),
      biasMa: numWithUnit(read(raw, `${p}.BiasCurrent`)),
      voltageV: numWithUnit(read(raw, `${p}.SupplyVottage`)),
      temperatureC: numWithUnit(read(raw, `${p}.TransceiverTemperature`)),
    };
  }
  // Cadangan: beberapa firmware yang sama hanya melaporkan RX/TX di sini (tanpa bias/tegangan).
  for (const root of ROOTS) {
    const p = `${root}.DeviceInfo.XponInterface`;
    const rx = numWithUnit(read(raw, `${p}.RXPower`));
    if (rx === null) continue;
    return {
      ...empty,
      rxDbm: rx,
      txDbm: numWithUnit(read(raw, `${p}.TXPower`)),
      temperatureC: numWithUnit(read(raw, `${p}.TransceiverTemperature`)),
    };
  }
  // ZIMLINK ZL-2113X (OLT: "HWTC H113") dan firmware CT-COM sejenis: satuan MENTAH di
  // X_CT-COM_EponInterfaceConfig. RX/TX dalam 0,1 uW (dBm = 10 log10(nilai x 0,0001)), suhu dalam
  // 1/256 derajat C, bias dalam uA, tegangan dalam 0,1 mV. Diukur terhadap OLT untuk ONU yang sama:
  // RX -20,81 = -20,81 dBm, TX 1,32 ~ 1,31, redaman 22,13 ~ 22,12.
  for (const root of ROOTS) {
    const p = `${root}.WANDevice.1.X_CT-COM_EponInterfaceConfig`;
    const rx = dbmFromTenthsOfMicrowatt(read(raw, `${p}.RXPower`));
    if (rx === null) continue;
    const temp = num(read(raw, `${p}.TransceiverTemperature`));
    const bias = num(read(raw, `${p}.BiasCurrent`));
    const volt = num(read(raw, `${p}.SupplyVottage`));
    return {
      rxDbm: rx,
      txDbm: dbmFromTenthsOfMicrowatt(read(raw, `${p}.TXPower`)),
      biasMa: bias === null ? null : round2(bias / 1000),
      voltageV: volt === null ? null : round2(volt / 10000),
      temperatureC: temp === null || temp === 0 ? null : round2(temp / 256),
    };
  }
  for (const root of ROOTS) {
    const p = `${root}.WANDevice.1.X_CT-COM_GponInterfaceConfig`;
    const rx = dbmFromTenthsOfMicrowatt(read(raw, `${p}.RXPower`));
    if (rx === null) continue;
    const temp = num(read(raw, `${p}.TransceiverTemperature`));
    const bias = num(read(raw, `${p}.BiasCurrent`));
    const volt = num(read(raw, `${p}.SupplyVottage`));
    return {
      rxDbm: rx,
      txDbm: dbmFromTenthsOfMicrowatt(read(raw, `${p}.TXPower`)),
      biasMa: bias === null ? null : round2(bias / 1000),
      voltageV: volt === null ? null : round2(volt / 10000),
      temperatureC: temp === null || temp === 0 ? null : round2(temp / 256),
    };
  }
  // ZTE F609 & Huawei HG8245H (China Mobile / CMCC): satuan MENTAH di X_CMCC_EponInterfaceConfig / GponInterfaceConfig
  for (const root of ROOTS) {
    for (const type of ["Epon", "Gpon"]) {
      const p = `${root}.WANDevice.1.X_CMCC_${type}InterfaceConfig`;
      const rx = dbmFromTenthsOfMicrowatt(read(raw, `${p}.RXPower`));
      if (rx === null) continue;
      const temp = num(read(raw, `${p}.TransceiverTemperature`));
      const bias = num(read(raw, `${p}.BiasCurrent`));
      const volt = num(read(raw, `${p}.SupplyVottage`));
      return {
        rxDbm: rx,
        txDbm: dbmFromTenthsOfMicrowatt(read(raw, `${p}.TXPower`)),
        biasMa: bias === null ? null : round2(bias / 1000),
        voltageV: volt === null ? null : round2(volt / 10000),
        temperatureC: temp === null || temp === 0 ? null : round2(temp / 256),
      };
    }
  }
  for (const root of ROOTS) {
    const p = `${root}.Optical.Interface.1`;
    const rawSignal = num(read(raw, `${p}.OpticalSignalLevel`));
    if (rawSignal === null) continue;
    const rx =
      Math.abs(rawSignal) > 100 ? round2(rawSignal * 0.001) : round2(rawSignal);
    const rawTx = num(read(raw, `${p}.TransmitOpticalLevel`));
    const tx =
      rawTx !== null
        ? Math.abs(rawTx) > 100
          ? round2(rawTx * 0.001)
          : round2(rawTx)
        : null;
    return {
      ...empty,
      rxDbm: rx,
      txDbm: tx,
    };
  }
  // Fallback ke VirtualParameters.rxPower jika tersedia dari skrip GenieACS
  const vpRx = num(readAny(raw, "VirtualParameters.rxPower"));
  const vpTx = num(readAny(raw, "VirtualParameters.txPower"));
  if (vpRx !== null) {
    return {
      ...empty,
      rxDbm: round2(vpRx),
      txDbm: vpTx !== null ? round2(vpTx) : null,
    };
  }
  return empty;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 0,1 uW mentah -> dBm; nol atau negatif (tanpa sinyal) = null, bukan -infinity. */
function dbmFromTenthsOfMicrowatt(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? round2(10 * Math.log10(n * 0.0001)) : null;
}

/** Kesehatan modem dari parameter TR-098 baseline (lebih mungkin lintas-merek). */
function parseHealth(raw: Raw): CpeHealth {
  const cpuPercent = num(readAny(raw, "DeviceInfo.ProcessStatus.CPUUsage"));
  const memoryFreeKb = num(readAny(raw, "DeviceInfo.MemoryStatus.Free"));
  const memoryTotalKb = num(readAny(raw, "DeviceInfo.MemoryStatus.Total"));
  const temperatures: CpeTemperatureSensor[] = [];
  for (const root of ROOTS) {
    const base = `${root}.DeviceInfo.TemperatureStatus.TemperatureSensor`;
    for (const i of indexes(raw, base)) {
      const celsius = num(read(raw, `${base}.${i}.Value`));
      if (celsius === null) continue;
      const name = str(read(raw, `${base}.${i}.Name`)) || `Sensor ${i}`;
      temperatures.push({ name, celsius });
    }
    if (temperatures.length > 0) break; // satu root sudah cukup, hindari dobel
  }
  return { cpuPercent, memoryFreeKb, memoryTotalKb, temperatures };
}

/** MAC modem: ManagementServer (vendor) atau antarmuka WAN PPP sebagai cadangan. */
function readMac(raw: Raw): string {
  const mgmt = str(readAny(raw, "ManagementServer.mac"));
  if (mgmt) return mgmt;
  const base = "InternetGatewayDevice.WANDevice.1.WANConnectionDevice";
  for (const i of indexes(raw, base)) {
    for (const kind of ["WANPPPConnection", "WANIPConnection"]) {
      for (const j of indexes(raw, `${base}.${i}.${kind}`)) {
        const mac = str(read(raw, `${base}.${i}.${kind}.${j}.MACAddress`));
        if (mac) return mac;
      }
    }
  }
  return "";
}

/**
 * Ubah dokumen device GenieACS (TR-098 `InternetGatewayDevice.*` atau TR-181
 * `Device.*`) menjadi CpeDevice. Parameter yang hilang menjadi nilai kosong, tidak melempar.
 * `nowSeconds` hanya untuk menentukan online/offline.
 */
export function mapGenieAcsToCpe(
  raw: unknown,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): CpeDevice {
  const r: Raw = isObj(raw) ? raw : {};
  const idObj: Raw = isObj(r._deviceId) ? r._deviceId : {};
  const deviceId = str(r._id);

  // _id GenieACS: OUI-ProductClass-Serial (bagian dapat di-URL-encode).
  let idParts: string[] = [];
  try {
    idParts = decodeURIComponent(deviceId).split("-");
  } catch {
    idParts = deviceId.split("-");
  }
  const oui = str(idObj._OUI) || (idParts.length >= 3 ? idParts[0] : "");
  const productClass =
    str(idObj._ProductClass) ||
    (idParts.length >= 3 ? idParts.slice(1, -1).join("-") : "");
  const serialNumber =
    str(readAny(r, "DeviceInfo.SerialNumber")) ||
    str(idObj._SerialNumber) ||
    (idParts.length >= 3 ? idParts[idParts.length - 1] : "");

  const manufacturer =
    str(readAny(r, "DeviceInfo.Manufacturer")) || str(idObj._Manufacturer);
  const model =
    str(readAny(r, "DeviceInfo.ModelName")) ||
    str(readAny(r, "DeviceInfo.ProductClass")) ||
    productClass;

  const uptimeSeconds = Math.max(
    0,
    Math.floor(num(readAny(r, "DeviceInfo.UpTime")) ?? 0),
  );
  const lastInformAt = toEpochSeconds(
    r._lastInform ?? readAny(r, "ManagementServer.LastInform"),
  );
  const isOnline =
    lastInformAt > 0 && nowSeconds - lastInformAt <= ONLINE_WINDOW_SECONDS;

  const hosts = parseHosts(r);
  const wanIp = firstWanIp(r);
  const lanIp =
    str(
      read(
        r,
        "InternetGatewayDevice.LANDevice.1.LANHostConfigManagement.IPInterface.1.IPInterfaceIPAddress",
      ),
    ) || str(read(r, "Device.IP.Interface.1.IPv4Address.1.IPAddress"));
  const optical = parseOptical(r);
  const health = parseHealth(r);
  // Modem tanpa sensor suhu terpisah (mis. ZL-2113X) tetap melaporkan suhu modul optiknya.
  if (health.temperatures.length === 0 && optical.temperatureC !== null) {
    health.temperatures.push({
      name: "Modul optik",
      celsius: optical.temperatureC,
    });
  }

  return {
    id: deviceId ? `cpe-${deviceId}` : "",
    deviceId,
    customerId: "",
    customerName: "",
    // Pencocokan ke pelanggan dilakukan pemanggil (mis. lewat username PPPoE ini).
    pppoeUsername: readPppoeUsername(r),
    address: "",
    odpName: "",
    routerId: "",
    model,
    manufacturer,
    oui,
    productClass,
    serialNumber,
    hardwareVersion: str(readAny(r, "DeviceInfo.HardwareVersion")),
    softwareVersion: str(readAny(r, "DeviceInfo.SoftwareVersion")),
    uptimeSeconds,
    uptimeText: uptimeSeconds > 0 ? formatUptime(uptimeSeconds) : "—",
    wanIp,
    lanIp,
    macAddress: readMac(r),
    isOnline,
    lastInformAt,
    // Dipakai luas di aplikasi untuk status sinyal; sama dengan optical.rxDbm, 0 bila
    // tidak diketahui (konsisten dengan pemakai lama field ini).
    opticalPowerDbm: optical.rxDbm ?? 0,
    optical,
    health,
    wifi: parseWifi(r, hosts.filter((h) => h.active).length),
    hosts,
    acs: {
      url: str(readAny(r, "ManagementServer.URL")),
      informEnabled: bool(readAny(r, "ManagementServer.PeriodicInformEnable")),
      informIntervalSec: num(
        readAny(r, "ManagementServer.PeriodicInformInterval"),
      ),
      connectionRequestUrl: str(
        readAny(r, "ManagementServer.ConnectionRequestURL"),
      ),
    },
  };
}

// ---------- klien ----------

export class GenieAcsClient {
  private readonly config: GenieAcsConfig;
  private readonly fetchImpl?: Fetcher;

  constructor(
    config: GenieAcsConfig = getGenieacsConfig(),
    fetchImpl?: Fetcher,
  ) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  private async request(path: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.config.authHeader) headers.Authorization = this.config.authHeader;
    try {
      return await (this.fetchImpl ?? globalThis.fetch)(
        `${this.config.url}${path}`,
        {
          method: "GET",
          headers,
          signal: controller.signal,
          cache: "no-store",
        },
      );
    } catch (err) {
      if (controller.signal.aborted) {
        throw new GenieAcsError(
          `GenieACS tidak menjawab dalam ${this.config.timeoutMs} ms`,
        );
      }
      throw new GenieAcsError(
        err instanceof Error ? err.message : "Gagal terhubung ke GenieACS",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchArray(path: string): Promise<unknown[] | null> {
    const res = await this.request(path);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new GenieAcsError(
        res.status === 401 || res.status === 403
          ? `GenieACS menolak kredensial (HTTP ${res.status})`
          : `GenieACS membalas HTTP ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new GenieAcsError(
        "Balasan GenieACS bukan JSON yang valid",
        res.status,
      );
    }
    if (!Array.isArray(body))
      throw new GenieAcsError("Balasan GenieACS bukan array", res.status);
    return body;
  }

  async testConnection(): Promise<{
    ok: boolean;
    latencyMs: number;
    error?: string;
    deviceCount?: number;
  }> {
    if (this.config.mode === "simulator") {
      return {
        ok: true,
        latencyMs: SIMULATOR_LATENCY_MS,
        deviceCount: SIMULATOR_DEVICE_COUNT,
      };
    }
    const started = Date.now();
    try {
      const items = await this.fetchArray(
        "/devices/?query=%7B%7D&projection=_id",
      );
      const latencyMs = Date.now() - started;
      if (items === null)
        return {
          ok: false,
          latencyMs,
          error: "Endpoint /devices/ tidak ditemukan (HTTP 404)",
        };
      return { ok: true, latencyMs, deviceCount: items.length };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error:
          err instanceof Error ? err.message : "Gagal terhubung ke GenieACS",
      };
    }
  }

  async getDevice(deviceId: string): Promise<CpeDevice | null> {
    if (this.config.mode === "simulator") {
      return (
        simulatorDevices().find(
          (d) => d.deviceId === deviceId || d.id === deviceId,
        ) ?? null
      );
    }
    const query = encodeURIComponent(JSON.stringify({ _id: deviceId }));
    const items = await this.fetchArray(`/devices/?query=${query}`);
    if (!items || items.length === 0) return null;
    return mapGenieAcsToCpe(items[0]);
  }

  /**
   * Data mentah satu perangkat dari NBI (untuk halaman rincian). Null bila tidak ada
   * atau mode simulator (tidak ada data mentah). Pemanggil menyaring rahasia sendiri.
   */
  async getRawDevice(deviceId: string): Promise<unknown | null> {
    if (this.config.mode === "simulator") return null;
    const query = encodeURIComponent(JSON.stringify({ _id: deviceId }));
    const items = await this.fetchArray(`/devices/?query=${query}`);
    return items && items.length > 0 ? items[0] : null;
  }

  async listDevices(): Promise<CpeDevice[]> {
    if (this.config.mode === "simulator") return simulatorDevices();
    const items = await this.fetchArray("/devices/");
    if (items === null)
      throw new GenieAcsError(
        "Endpoint /devices/ tidak ditemukan (HTTP 404)",
        404,
      );
    return items.map((item) => mapGenieAcsToCpe(item));
  }

  /** Cari _id perangkat dari username PPPoE (TR-098 WANPPPConnection.1). Null bila tak ketemu. */
  async findDeviceIdByPppoe(username: string): Promise<string | null> {
    if (this.config.mode === "simulator") {
      return (
        simulatorDevices().find((d) => d.pppoeUsername === username)
          ?.deviceId ?? null
      );
    }
    const key =
      "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Username._value";
    const query = encodeURIComponent(JSON.stringify({ [key]: username }));
    const items = await this.fetchArray(
      `/devices/?query=${query}&projection=_id`,
    );
    const id = items?.[0];
    return isObj(id) && typeof id._id === "string" ? id._id : null;
  }

  /**
   * Dorong task ke NBI. Pesan error sengaja tetap/generik: isi task (bisa memuat kata sandi)
   * dan badan balasan tidak boleh ikut masuk ke pesan.
   */
  async postTask(
    deviceId: string,
    task: Record<string, unknown>,
    connectionRequest = true,
    /**
     * Lama NBI menunggu modem menyelesaikan task (milidetik). Bawaan NBI hanya 3 detik; yang
     * lebih lama (mis. ubah Wi-Fi) memberi batas sendiri dan 200 berarti SELESAI, 202 antre.
     */
    waitMs?: number,
  ): Promise<{
    ok: boolean;
    taskId?: string;
    error?: string;
    status?: number;
  }> {
    if (this.config.mode === "simulator")
      return { ok: true, taskId: `sim-task-${Date.now()}` };

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      waitMs
        ? Math.max(this.config.timeoutMs, waitMs + 3000)
        : this.config.timeoutMs,
    );
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.authHeader) headers.Authorization = this.config.authHeader;
    const query = connectionRequest
      ? waitMs
        ? `?connection_request&timeout=${Math.floor(waitMs)}`
        : "?connection_request"
      : "";
    const url = `${this.config.url}/devices/${encodeURIComponent(deviceId)}/tasks${query}`;
    try {
      const res = await (this.fetchImpl ?? globalThis.fetch)(url, {
        method: "POST",
        headers,
        body: JSON.stringify(task),
        signal: controller.signal,
        cache: "no-store",
      });
      if (res.ok) {
        let taskId: string | undefined;
        try {
          const body: unknown = await res.json();
          if (isObj(body) && typeof body._id === "string") taskId = body._id;
        } catch {
          // Badan kosong / bukan JSON: task tetap diterima.
        }
        return { ok: true, taskId, status: res.status };
      }
      const error =
        res.status === 404
          ? "Perangkat tidak ditemukan di GenieACS (HTTP 404)"
          : res.status === 409
            ? "Konflik: task bentrok dengan task lain di GenieACS (HTTP 409)"
            : res.status === 504
              ? "Perangkat tidak menjawab connection request, mungkin offline (HTTP 504)"
              : res.status === 401 || res.status === 403
                ? `GenieACS menolak kredensial (HTTP ${res.status})`
                : `GenieACS membalas HTTP ${res.status}`;
      return { ok: false, error, status: res.status };
    } catch {
      return {
        ok: false,
        error: controller.signal.aborted
          ? `GenieACS tidak menjawab dalam ${this.config.timeoutMs} ms`
          : "Gagal terhubung ke GenieACS",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Hapus task dari antrean GenieACS (mis. bila diantre 202 saat probe realtime agar tidak retry). */
  async deleteTask(taskId: string): Promise<boolean> {
    if (this.config.mode === "simulator") return true;
    try {
      const headers: Record<string, string> = {};
      if (this.config.authHeader)
        headers.Authorization = this.config.authHeader;
      const res = await (this.fetchImpl ?? globalThis.fetch)(
        `${this.config.url}/tasks/${encodeURIComponent(taskId)}`,
        {
          method: "DELETE",
          headers,
        },
      );
      return res.ok || res.status === 404;
    } catch {
      return false;
    }
  }

  /** Ubah SSID (dan kata sandi bila diberikan) WLAN 1 lewat setParameterValues TR-098. */
  async setWifiConfig(
    deviceId: string,
    options: { ssid: string; password?: string },
  ): Promise<{
    ok: boolean;
    taskId?: string;
    error?: string;
    status?: number;
  }> {
    const base = "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1";
    const parameterValues: [string, string, string][] = [
      [`${base}.SSID`, options.ssid, "xsd:string"],
    ];
    if (options.password) {
      parameterValues.push([
        `${base}.PreSharedKey.1.PreSharedKey`,
        options.password,
        "xsd:string",
      ]);
    }
    return this.postTask(deviceId, {
      name: "setParameterValues",
      parameterValues,
    });
  }
}
