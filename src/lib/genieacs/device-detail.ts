// Rincian satu modem dari data mentah GenieACS NBI (TR-098). Murni (tanpa server-only
// dan alias path) supaya bisa diuji dengan node --test.
//
// Dua bentuk dengan sengaja DIPISAH:
//   - parseDeviceDetail: tanpa rahasia apa pun, aman untuk semua pengguna login.
//   - parseDeviceSecrets: sandi Wi-Fi dan sandi admin web modem. Hanya dipanggil dari
//     endpoint yang meminta izin cpe:manage dan mencatat audit.

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/** Nilai satu parameter pada path bertitik, atau undefined. Kunci berawalan "_" adalah metadata. */
export function readParam(raw: unknown, path: string): unknown {
  let node: unknown = raw;
  for (const key of path.split(".")) {
    if (!isObj(node)) return undefined;
    node = node[key];
  }
  return isObj(node) ? node._value : undefined;
}

/** Cek apakah sebuah node/objek atau parameter ada di pohon mentah GenieACS. */
export function hasNode(raw: unknown, path: string): boolean {
  let node: unknown = raw;
  for (const key of path.split(".")) {
    if (!isObj(node)) return false;
    node = node[key];
  }
  return isObj(node);
}

/** Anak-anak bernomor (instance) di bawah sebuah objek, urut naik. */
function instances(raw: unknown, path: string): { index: string; node: Raw }[] {
  let node: unknown = raw;
  for (const key of path.split(".")) {
    if (!isObj(node)) return [];
    node = node[key];
  }
  if (!isObj(node)) return [];
  return Object.keys(node)
    .filter((k) => /^\d+$/.test(k) && isObj(node && (node as Raw)[k]))
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => ({ index: k, node: (node as Raw)[k] as Raw }));
}

const text = (v: unknown): string => (v === undefined || v === null ? "" : String(v).trim());
const num = (v: unknown): number | null => {
  const f = parseFloat(text(v));
  return Number.isFinite(f) ? f : null;
};
const bool = (v: unknown): boolean => v === true || v === "true" || v === 1 || v === "1";
const sub = (node: Raw, path: string): unknown => readParam(node, path);
export const isJunkMac = (mac: string): boolean => Boolean(mac) && (/^00:00:00:00:00:/i.test(mac) || /^00[:-]00[:-]00[:-]00[:-]00[:-]00$/i.test(mac));

const IGD = "InternetGatewayDevice";

export interface DetailWan {
  name: string;
  username: string;
  status: string;
  ip: string;
  mac: string;
  uptimeSeconds: number | null;
  kind: "PPPoE" | "IPoE";
}

export interface DetailWlan {
  index: number;
  ssid: string;
  enabled: boolean;
  channel: number | null;
  standard: string;
  clients: number;
  /** Ada sandi yang bisa ditampilkan lewat endpoint sandi (tidak membocorkan nilainya). */
  hasPassphrase: boolean;
}

export interface DetailHost {
  hostname: string;
  ip: string;
  mac: string;
  interfaceType: string;
  band: string;
  active: boolean;
}

export interface CpeDetail {
  deviceId: string;
  serialNumber: string;
  manufacturer: string;
  oui: string;
  productClass: string;
  hardwareVersion: string;
  softwareVersion: string;
  ponType: "EPON" | "GPON" | "";
  pppoeUsername: string;
  wanIp: string;
  tr069Ip: string;
  macAddress: string;
  uptimeSeconds: number | null;
  lastInform: string;
  registered: string;
  acs: { url: string; username: string; informEnabled: boolean; informInterval: number | null; connectionRequestUrl: string };
  optical: {
    rxDbm: number | null;
    txDbm: number | null;
    /** Redaman = TX - RX (dB); null bila salah satunya tidak terbaca. */
    lossDb: number | null;
    temperatureC: number | null;
    biasMa: number | null;
    voltageV: number | null;
  };
  health: { cpuPercent: number | null; memoryFreeKb: number | null; memoryTotalKb: number | null; temperatures: { name: string; celsius: number }[] };
  wans: DetailWan[];
  wlans: DetailWlan[];
  hosts: DetailHost[];
  activeClients: number;
}

function dbm(v: unknown): number | null {
  return num(v);
}

export function parseDeviceDetail(raw: unknown): CpeDetail {
  const r = isObj(raw) ? raw : {};
  // NBI menyimpan identitas di "_deviceId" ({_Manufacturer, _OUI, _ProductClass, _SerialNumber}).
  const rid = (key: string) =>
    text(isObj(r._deviceId) ? (r._deviceId as Raw)[`_${key}`] : "") ||
    text(readParam(r, `DeviceID.${key}`)) ||
    text(isObj(r.DeviceID) ? (r.DeviceID as Raw)[`_${key}`] : "");

  const wans: DetailWan[] = [];
  for (const dev of instances(r, `${IGD}.WANDevice`)) {
    for (const conn of instances(dev.node, "WANConnectionDevice")) {
      for (const kind of ["WANPPPConnection", "WANIPConnection"] as const) {
        for (const w of instances(conn.node, kind)) {
          wans.push({
            kind: kind === "WANPPPConnection" ? "PPPoE" : "IPoE",
            name: text(sub(w.node, "Name")),
            username: text(sub(w.node, "Username")),
            status: text(sub(w.node, "ConnectionStatus")),
            ip: text(sub(w.node, "ExternalIPAddress")),
            mac: text(sub(w.node, "MACAddress")).toLowerCase(),
            uptimeSeconds: num(sub(w.node, "Uptime")),
          });
        }
      }
    }
  }
  const pppoe = wans.find((w) => w.kind === "PPPoE" && w.username) ?? wans.find((w) => w.username);
  const wanWithIp = wans.find((w) => w.ip && w.ip !== "0.0.0.0");

  const connReq = text(readParam(r, `${IGD}.ManagementServer.ConnectionRequestURL`));
  const tr069Ip = /^https?:\/\/([^:/]+)/i.exec(connReq)?.[1] ?? "";

  const wlans: DetailWlan[] = [];
  const lan = instances(r, `${IGD}.LANDevice`)[0];
  const hosts: DetailHost[] = [];
  if (lan) {
    const associatedMacs = new Set<string>();
    const associatedHosts: DetailHost[] = [];
    for (const w of instances(lan.node, "WLANConfiguration")) {
      const pass = text(sub(w.node, "X_CMS_KeyPassphrase")) || text(sub(w.node, "KeyPassphrase"));
      const assocs = instances(w.node, "AssociatedDevice");
      for (const a of assocs) {
        const mac = (text(sub(a.node, "AssociatedDeviceMACAddress")) || text(sub(a.node, "MACAddress"))).toLowerCase();
        const ip = text(sub(a.node, "AssociatedDeviceIPAddress")) || text(sub(a.node, "IPAddress"));
        const rssi = num(sub(a.node, "RSSI"));
        if (mac && !isJunkMac(mac)) {
          associatedMacs.add(mac);
          associatedHosts.push({
            hostname: "",
            ip,
            mac,
            interfaceType: "802.11",
            band: rssi !== null ? `Wi-Fi (${rssi} dBm)` : "Wi-Fi",
            active: true,
          });
        }
      }
      const clientCount = Math.max(assocs.length, num(sub(w.node, "TotalAssociations")) ?? 0);
      wlans.push({
        index: Number(w.index),
        ssid: text(sub(w.node, "SSID")),
        enabled: bool(sub(w.node, "Enable")),
        channel: num(sub(w.node, "Channel")),
        standard: text(sub(w.node, "Standard")),
        clients: clientCount,
        hasPassphrase: pass !== "",
      });
    }
    for (const h of instances(lan.node, "Hosts.Host")) {
      const iface = text(sub(h.node, "InterfaceType"));
      const mac = text(sub(h.node, "MACAddress")).toLowerCase();
      if (mac && isJunkMac(mac)) continue;
      const ip = text(sub(h.node, "IPAddress"));
      const hostname = text(sub(h.node, "HostName"));
      const activeRaw = sub(h.node, "Active");
      const isActive = associatedMacs.has(mac) || (activeRaw === undefined ? true : bool(activeRaw));
      hosts.push({
        hostname,
        ip,
        mac,
        interfaceType: iface,
        band: text(sub(h.node, "X_CMS_WirelessTerminal")),
        active: isActive,
      });
    }
    for (const ah of associatedHosts) {
      const existing = hosts.find((h) => h.mac === ah.mac);
      if (existing) {
        existing.active = true;
        if (!existing.band && ah.band) existing.band = ah.band;
      } else {
        hosts.push(ah);
      }
    }
  }

  const temps = instances(r, `${IGD}.DeviceInfo.TemperatureStatus.TemperatureSensor`)
    .map((s) => ({ name: text(sub(s.node, "Name")) || `Sensor ${s.index}`, celsius: num(sub(s.node, "Value")) }))
    .filter((t): t is { name: string; celsius: number } => t.celsius !== null);

  const epon = `${IGD}.WANDevice.1.X_CT-COM_EponInterfaceConfig`;
  const gpon = `${IGD}.WANDevice.1.X_CT-COM_GponInterfaceConfig`;
  const ponType = readParam(r, `${epon}.Status`) !== undefined ? "EPON" : readParam(r, `${gpon}.Status`) !== undefined ? "GPON" : "";

  const alu = `${IGD}.X_ALU_OntOpticalParam`;
  const xpon = `${IGD}.DeviceInfo.XponInterface`;
  const rawDbm = (path: string): number | null => {
    const v = num(readParam(r, path));
    return v !== null && v > 0 ? Math.round(10 * Math.log10(v * 0.0001) * 100) / 100 : null;
  };
  const rx = dbm(readParam(r, `${alu}.RXPower`)) ?? dbm(readParam(r, `${xpon}.RXPower`)) ?? rawDbm(`${epon}.RXPower`) ?? rawDbm(`${gpon}.RXPower`);
  const tx = dbm(readParam(r, `${alu}.TXPower`)) ?? dbm(readParam(r, `${xpon}.TXPower`)) ?? rawDbm(`${epon}.TXPower`) ?? rawDbm(`${gpon}.TXPower`);
  const rawTemp = num(readParam(r, `${epon}.TransceiverTemperature`));
  const aluTemp = dbm(readParam(r, `${alu}.TransceiverTemperature`));
  const temp = aluTemp ?? num(readParam(r, `${xpon}.TransceiverTemperature`)) ?? (rawTemp !== null && rawTemp !== 0 ? Math.round((rawTemp / 256) * 100) / 100 : null);
  const aluBias = num(readParam(r, `${alu}.BiasCurrent`));
  const aluVolt = num(readParam(r, `${alu}.SupplyVottage`));

  const lastInform = text(r._lastInform);
  const informInterval = num(readParam(r, `${IGD}.ManagementServer.PeriodicInformInterval`));

  return {
    deviceId: text(r._id),
    serialNumber: text(readParam(r, `${IGD}.DeviceInfo.SerialNumber`)) || rid("SerialNumber"),
    manufacturer: text(readParam(r, `${IGD}.DeviceInfo.Manufacturer`)) || rid("Manufacturer"),
    oui: rid("OUI"),
    productClass: rid("ProductClass"),
    hardwareVersion: text(readParam(r, `${IGD}.DeviceInfo.HardwareVersion`)),
    softwareVersion: text(readParam(r, `${IGD}.DeviceInfo.SoftwareVersion`)),
    ponType,
    pppoeUsername: pppoe?.username ?? "",
    wanIp: pppoe?.ip || wanWithIp?.ip || "",
    tr069Ip,
    macAddress:
      text(readParam(r, `${IGD}.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress`)).toLowerCase() || (wans[0]?.mac ?? ""),
    uptimeSeconds: num(readParam(r, `${IGD}.DeviceInfo.UpTime`)),
    lastInform,
    registered: text(r._registered),
    acs: {
      url: text(readParam(r, `${IGD}.ManagementServer.URL`)),
      username: text(readParam(r, `${IGD}.ManagementServer.Username`)),
      informEnabled: bool(readParam(r, `${IGD}.ManagementServer.PeriodicInformEnable`)),
      informInterval,
      connectionRequestUrl: connReq,
    },
    optical: {
      rxDbm: rx,
      txDbm: tx,
      lossDb: rx !== null && tx !== null ? Math.round((tx - rx) * 100) / 100 : null,
      temperatureC: temp,
      biasMa: aluBias !== null ? Math.round((aluBias > 1000 ? aluBias / 1000 : aluBias) * 100) / 100 : (() => {
        const b = num(readParam(r, `${epon}.BiasCurrent`));
        return b === null ? null : Math.round((b / 1000) * 100) / 100;
      })(),
      voltageV: aluVolt !== null ? Math.round(aluVolt * 100) / 100 : (() => {
        const v = num(readParam(r, `${epon}.SupplyVottage`));
        return v === null ? null : Math.round((v / 10000) * 100) / 100;
      })(),
    },
    health: {
      cpuPercent: num(readParam(r, `${IGD}.DeviceInfo.ProcessStatus.CPUUsage`)),
      memoryFreeKb: num(readParam(r, `${IGD}.DeviceInfo.MemoryStatus.Free`)),
      memoryTotalKb: num(readParam(r, `${IGD}.DeviceInfo.MemoryStatus.Total`)),
      // Tanpa sensor terpisah (mis. ZL-2113X), pakai suhu modul optik supaya tidak kosong.
      temperatures: temps.length === 0 && temp !== null ? [{ name: "Modul optik", celsius: temp }] : temps,
    },
    wans,
    wlans,
    hosts,
    activeClients: wlans.reduce((n, w) => n + w.clients, 0) + hosts.filter((h) => h.active && !/802\.11/.test(h.interfaceType)).length,
  };
}

export interface SecretAccount {
  /** Dari mana nilainya dibaca di modem; membantu operator memeriksa. */
  source: string;
  label: string;
  username: string;
  password: string;
  /** true bila akun ini yang dipakai aplikasi untuk login ke web modem. */
  usedByApp: boolean;
}

export interface DeviceSecrets {
  accounts: SecretAccount[];
  wifi: { index: number; ssid: string; passphrase: string }[];
}

export function parseDeviceSecrets(raw: unknown): DeviceSecrets {
  const r = isObj(raw) ? raw : {};
  const accounts: SecretAccount[] = [];
  const add = (source: string, label: string, userPath: string, passPath: string, usedByApp = false) => {
    const username = text(readParam(r, userPath));
    const password = text(readParam(r, passPath));
    if (username !== "" || password !== "") accounts.push({ source, label, username, password, usedByApp });
  };
  add("X_Authentication.WebAccount", "Admin web modem", `${IGD}.X_Authentication.WebAccount.UserName`, `${IGD}.X_Authentication.WebAccount.Password`, true);
  add("X_CT-COM_UserInfo", "Akun telekom (UserInfo)", `${IGD}.X_CT-COM_UserInfo.UserName`, `${IGD}.X_CT-COM_UserInfo.Password`);
  add("X_Authentication.Account", "Akun pengguna web modem", `${IGD}.X_Authentication.Account.UserName`, `${IGD}.X_Authentication.Account.ModifyPassword`);
  add("ManagementServer", "Akun ACS di modem", `${IGD}.ManagementServer.Username`, `${IGD}.ManagementServer.Password`);

  const wifi: DeviceSecrets["wifi"] = [];
  const lan = instances(r, `${IGD}.LANDevice`)[0];
  if (lan) {
    for (const w of instances(lan.node, "WLANConfiguration")) {
      const passphrase = text(sub(w.node, "X_CMS_KeyPassphrase")) || text(sub(w.node, "KeyPassphrase"));
      if (passphrase !== "") wifi.push({ index: Number(w.index), ssid: text(sub(w.node, "SSID")), passphrase });
    }
  }
  return { accounts, wifi };
}

// ---------------------------------------------------------------------------
// Ubah Wi-Fi (SSID dan/atau sandi) satu WLAN.
// ---------------------------------------------------------------------------

export class WifiChangeError extends Error {
  // Field eksplisit (bukan parameter property): node --test memakai mode strip-only.
  code: "WLAN_NOT_FOUND" | "NO_PASSPHRASE_PARAM" | "NOTHING_TO_CHANGE";
  constructor(code: "WLAN_NOT_FOUND" | "NO_PASSPHRASE_PARAM" | "NOTHING_TO_CHANGE", message: string) {
    super(message);
    this.name = "WifiChangeError";
    this.code = code;
  }
}

export interface WifiChangePlan {
  index: number;
  /** [path, nilai, tipe] untuk setParameterValues. Tidak pernah dicatat/dikembalikan ke klien. */
  parameterValues: [string, string, string][];
  /** Path yang dibaca ulang dari modem untuk verifikasi. */
  readBack: string[];
  ssid?: { path: string; value: string };
  passphrase?: { paths: string[]; value: string };
}

// Urutan penting: parameter vendor tempat modem menyimpan sandi aslinya dulu, lalu yang standar.
// Keduanya ditulis bila ADA dan bisa ditulis supaya tidak saling menimpa dengan nilai lama.
const PASSPHRASE_PARAMS = ["X_CMS_KeyPassphrase", "KeyPassphrase", "PreSharedKey.1.KeyPassphrase"] as const;

function node(raw: unknown, path: string): Raw | null {
  let n: unknown = raw;
  for (const k of path.split(".")) {
    if (!isObj(n)) return null;
    n = n[k];
  }
  return isObj(n) ? n : null;
}

/**
 * Menyusun perubahan Wi-Fi dari data modem. Hanya parameter yang benar-benar ada dan
 * writable di modem ini yang ditulis; tidak menebak path.
 */
export function planWifiChange(raw: unknown, input: { index: number; ssid?: string; password?: string }): WifiChangePlan {
  const base = `${IGD}.LANDevice.1.WLANConfiguration.${input.index}`;
  const wlan = node(raw, base);
  if (!wlan) throw new WifiChangeError("WLAN_NOT_FOUND", `Modem ini tidak punya SSID nomor ${input.index}.`);

  const plan: WifiChangePlan = { index: input.index, parameterValues: [], readBack: [] };
  if (input.ssid !== undefined) {
    const path = `${base}.SSID`;
    plan.parameterValues.push([path, input.ssid, "xsd:string"]);
    plan.readBack.push(path);
    plan.ssid = { path, value: input.ssid };
  }
  if (input.password !== undefined) {
    const paths: string[] = [];
    for (const rel of PASSPHRASE_PARAMS) {
      const n = node(wlan, rel);
      if (n && "_value" in n && n._writable !== false) paths.push(`${base}.${rel}`);
    }
    if (paths.length === 0) {
      throw new WifiChangeError("NO_PASSPHRASE_PARAM", "Modem ini tidak punya parameter sandi Wi-Fi yang bisa diubah lewat TR-069.");
    }
    for (const p of paths) plan.parameterValues.push([p, input.password, "xsd:string"]);
    plan.readBack.push(...paths);
    plan.passphrase = { paths, value: input.password };
  }
  if (plan.parameterValues.length === 0) {
    throw new WifiChangeError("NOTHING_TO_CHANGE", "Isi SSID baru atau sandi baru.");
  }
  return plan;
}

export interface WifiVerification {
  ssid: boolean | null;
  password: boolean | null;
}

/**
 * Membandingkan data modem (sesudah dibaca ulang) dengan yang diminta. null = tidak diminta
 * atau tidak bisa dibuktikan (modem melaporkan sandi kosong).
 */
export function verifyWifiChange(raw: unknown, plan: WifiChangePlan): WifiVerification {
  const result: WifiVerification = { ssid: null, password: null };
  if (plan.ssid) result.ssid = text(readParam(raw, plan.ssid.path)) === plan.ssid.value;
  if (plan.passphrase) {
    // Parameter yang melaporkan kosong (KeyPassphrase standar) tidak bisa membuktikan apa pun.
    const reported = plan.passphrase.paths.map((p) => text(readParam(raw, p))).filter((v) => v !== "");
    result.password = reported.length === 0 ? null : reported.every((v) => v === plan.passphrase!.value);
  }
  return result;
}
