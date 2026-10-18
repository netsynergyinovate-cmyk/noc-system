// Logika murni halaman "Perangkat CPE/ONT" (dulu Inventaris ONU): merek dan model dari
// teks model OLT, filter berfacet, dan pencocokan ke modem yang sudah terdaftar di
// GenieACS. Tanpa React dan tanpa alias path supaya bisa diuji dengan node --test.
import { getOpticalSignalStatus } from "./optical.ts";
import type { DashboardOnu, OnuStatusFilter } from "./onus.ts";
import { WEAK_RX_DBM } from "./onus.ts";

// ---------------------------------------------------------------------------
// Merek dan model
// ---------------------------------------------------------------------------

/** Kode vendor di depan teks model OLT ("CDTC 15CR") -> nama merek. Hanya yang pasti. */
const BRAND_ALIASES: Readonly<Record<string, string>> = {
  CDTC: "C-Data",
  HWTC: "Huawei",
  HSGQ: "HSGQ",
  HUAWEI: "Huawei",
  ZTE: "ZTE",
  FIBERHOME: "Fiberhome",
};

/**
 * Model yang kode vendornya menyesatkan: OLT melaporkan "HWTC H113" (HWTC = ID vendor GPON
 * Huawei), padahal modemnya ZIMLINK ZL-2113X (judul halaman webnya). Ditentukan per model supaya
 * model HWTC lain tetap dianggap Huawei.
 */
const MODEL_ALIASES: Readonly<Record<string, { brandKey: string; brandLabel: string; modelLabel: string }>> = {
  "HWTC H113": { brandKey: "ZIMLINK", brandLabel: "ZIMLINK (HWTC)", modelLabel: "H113 (ZL-2113X)" },
  // OLT melaporkan "ZICG GM22"; halaman web modemnya berjudul "GM220-S XPON" (GGCLink).
  "ZICG GM22": { brandKey: "GGCLINK", brandLabel: "GGCLink (ZICG)", modelLabel: "GM22 (GM220-S XPON)" },
  // OLT melaporkan "MTKc F609" (MediaTek); halaman webnya ZTE F609. Hanya F609 yang sudah dipetakan, jadi
  // MTKc lain (mis. 245H) tetap dengan kode vendornya.
  "MTKC F609": { brandKey: "F609", brandLabel: "ZTE F609 (MTKc)", modelLabel: "F609" },
};

export const UNKNOWN_BRAND_KEY = "?";
export const UNKNOWN_MODEL_KEY = "?";

export interface OnuIdentity {
  /** Kunci stabil untuk filter (kode vendor huruf besar); "?" bila model tidak dilaporkan. */
  brandKey: string;
  /** Teks untuk ditampilkan: "C-Data (CDTC)" bila kode dikenal, selain itu kodenya. */
  brandLabel: string;
  modelKey: string;
  modelLabel: string;
}

/**
 * "CDTC 15CR" -> merek CDTC, model 15CR. Token pertama = vendor, sisanya = tipe. Teks kosong
 * (OLT tidak melaporkan model) = "Tidak diketahui", bukan salah satu merek.
 */
export function parseOnuModel(model: string | null | undefined): OnuIdentity {
  const text = (model ?? "").trim().replace(/\s+/g, " ");
  if (text === "" || text === "-") {
    return { brandKey: UNKNOWN_BRAND_KEY, brandLabel: "Tidak diketahui", modelKey: UNKNOWN_MODEL_KEY, modelLabel: "Tidak diketahui" };
  }
  const modelAlias = MODEL_ALIASES[text.toUpperCase()];
  if (modelAlias) return { ...modelAlias, modelKey: text.slice(text.indexOf(" ") + 1).toUpperCase() };
  const space = text.indexOf(" ");
  const code = space === -1 ? text : text.slice(0, space);
  const type = space === -1 ? "" : text.slice(space + 1);
  const brandKey = code.toUpperCase();
  const alias = BRAND_ALIASES[brandKey];
  return {
    brandKey,
    brandLabel: alias && alias.toUpperCase() !== brandKey ? `${alias} (${code})` : code,
    modelKey: type === "" ? UNKNOWN_MODEL_KEY : type.toUpperCase(),
    modelLabel: type === "" ? "Tanpa tipe" : type,
  };
}

// ---------------------------------------------------------------------------
// Pencocokan ke GenieACS
// ---------------------------------------------------------------------------

/** Bagian CpeDevice yang dipakai pencocokan. */
export interface CpeLite {
  deviceId: string;
  pppoeUsername: string;
  macAddress: string;
  isOnline: boolean;
}

export interface CpeMatch {
  deviceId: string;
  via: "pppoe" | "mac";
  isOnline: boolean;
}

const normPppoe = (s: string) => s.trim().toLowerCase();

// MAC 48-bit muat persis dalam Number (batas aman 2^53), jadi tidak perlu BigInt.
function macValue(s: string): number | null {
  const h = s.replace(/[:-]/g, "").trim();
  return /^[0-9a-fA-F]{12}$/.test(h) ? parseInt(h, 16) : null;
}

/** Lima oktet pertama (tanpa oktet terakhir). */
const macPrefix = (v: number) => Math.floor(v / 256);

/** Selisih terjauh antara MAC ONU di OLT dan MAC modem (LAN = +1, WAN = +2 pada keluarga FD511GW). */
export const MAC_MAX_DELTA = 3;

/**
 * ONU -> modem di GenieACS. Aturan, berurutan:
 *  1. Nama PPPoE pelanggan sama persis (tanpa beda huruf besar/kecil).
 *  2. MAC: lima oktet pertama sama dan selisih 0..3 ke atas, HANYA bila tepat satu modem yang
 *     cocok untuk ONU itu dan modem itu belum dipakai ONU lain. Tidak pernah menebak.
 * Satu modem paling banyak cocok dengan satu ONU.
 */
export function matchOnusToCpe(onus: readonly DashboardOnu[], devices: readonly CpeLite[]): Map<string, CpeMatch> {
  const out = new Map<string, CpeMatch>();
  const claimed = new Set<string>();

  const byPppoe = new Map<string, CpeLite[]>();
  for (const d of devices) {
    const key = normPppoe(d.pppoeUsername);
    if (key) byPppoe.set(key, [...(byPppoe.get(key) ?? []), d]);
  }
  for (const o of onus) {
    const key = normPppoe(o.pppoeUsername);
    if (!key || key === "-") continue;
    const found = byPppoe.get(key);
    if (found?.length === 1 && !claimed.has(found[0].deviceId)) {
      claimed.add(found[0].deviceId);
      out.set(o.id, { deviceId: found[0].deviceId, via: "pppoe", isOnline: found[0].isOnline });
    }
  }

  const candidates = new Map<string, CpeLite[]>();
  for (const o of onus) {
    if (out.has(o.id)) continue;
    const want = macValue(o.serialNumber);
    if (want === null) continue;
    const list = devices.filter((d) => {
      if (claimed.has(d.deviceId)) return false;
      const got = macValue(d.macAddress);
      return got !== null && macPrefix(got) === macPrefix(want) && got >= want && got - want <= MAC_MAX_DELTA;
    });
    if (list.length === 1) candidates.set(o.id, list);
  }
  // Dua ONU yang menunjuk modem yang sama: keduanya dilewati.
  const demand = new Map<string, number>();
  for (const [, list] of candidates) demand.set(list[0].deviceId, (demand.get(list[0].deviceId) ?? 0) + 1);
  for (const [onuId, list] of candidates) {
    if (demand.get(list[0].deviceId) === 1) out.set(onuId, { deviceId: list[0].deviceId, via: "mac", isOnline: list[0].isOnline });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Filter berfacet
// ---------------------------------------------------------------------------

export type GenieacsFilter = "all" | "registered" | "unregistered";

export interface InventoryFilter {
  query: string;
  status: OnuStatusFilter;
  oltId: string;
  /** Kunci merek (parseOnuModel().brandKey) atau "all". */
  brand: string;
  /** Kunci model atau "all". Hanya bermakna bersama merek yang sama. */
  model: string;
  genieacs: GenieacsFilter;
}

export const EMPTY_INVENTORY_FILTER: InventoryFilter = {
  query: "",
  status: "all",
  oltId: "all",
  brand: "all",
  model: "all",
  genieacs: "all",
};

type Dimension = "status" | "olt" | "brand" | "model" | "genieacs";

function matchesWith(
  o: DashboardOnu,
  f: InventoryFilter,
  reg: ReadonlyMap<string, CpeMatch> | null,
  skip?: Dimension,
): boolean {
  if (skip !== "status") {
    if (f.status === "online" && o.status !== "online") return false;
    if (f.status === "offline" && o.status !== "offline") return false;
    if (f.status === "los" && o.status !== "los") return false;
    if (f.status === "weak" && (o.rxPowerDbm === null || o.rxPowerDbm >= WEAK_RX_DBM)) return false;
    if (f.status === "out" && !getOpticalSignalStatus(o.status === "los" ? null : o.rxPowerDbm).isOutOfThreshold) return false;
  }
  if (skip !== "olt" && f.oltId !== "all" && o.oltId !== f.oltId) return false;
  const id = parseOnuModel(o.model);
  if (skip !== "brand" && f.brand !== "all" && id.brandKey !== f.brand) return false;
  if (skip !== "model" && f.model !== "all" && id.modelKey !== f.model) return false;
  if (skip !== "genieacs" && f.genieacs !== "all" && reg !== null) {
    const registered = reg.has(o.id);
    if (f.genieacs === "registered" && !registered) return false;
    if (f.genieacs === "unregistered" && registered) return false;
  }
  const q = f.query.trim().toLowerCase();
  if (!q) return true;
  return [o.serialNumber, o.customerName, o.pppoeUsername, o.ponPort, o.model, id.brandLabel].some((s) => s.toLowerCase().includes(q));
}

export function filterInventory(
  onus: readonly DashboardOnu[],
  f: InventoryFilter,
  reg: ReadonlyMap<string, CpeMatch> | null,
): DashboardOnu[] {
  return onus.filter((o) => matchesWith(o, f, reg));
}

export interface FacetOption {
  key: string;
  label: string;
  /** Berapa ONU yang tersisa bila opsi ini dipilih (dimensi lain tetap). */
  count: number;
}

/** Daftar merek dengan jumlahnya; terbanyak dulu, "Tidak diketahui" terakhir. */
export function brandOptions(onus: readonly DashboardOnu[], f: InventoryFilter, reg: ReadonlyMap<string, CpeMatch> | null): FacetOption[] {
  const map = new Map<string, FacetOption>();
  for (const o of onus) {
    const id = parseOnuModel(o.model);
    const opt = map.get(id.brandKey) ?? { key: id.brandKey, label: id.brandLabel, count: 0 };
    if (matchesWith(o, f, reg, "brand")) opt.count++;
    map.set(id.brandKey, opt);
  }
  return sortOptions([...map.values()]);
}

/** Model dengan jumlahnya. Bila merek dipilih, hanya model milik merek itu. */
export function modelOptions(onus: readonly DashboardOnu[], f: InventoryFilter, reg: ReadonlyMap<string, CpeMatch> | null): FacetOption[] {
  const map = new Map<string, FacetOption>();
  for (const o of onus) {
    const id = parseOnuModel(o.model);
    if (f.brand !== "all" && id.brandKey !== f.brand) continue;
    const key = `${id.brandKey}|${id.modelKey}`;
    const label = f.brand === "all" ? (id.brandKey === UNKNOWN_BRAND_KEY ? id.modelLabel : `${id.brandLabel.split(" (")[0]} ${id.modelLabel}`) : id.modelLabel;
    const opt = map.get(key) ?? { key: id.modelKey, label, count: 0 };
    if (matchesWith(o, f, reg, "model")) opt.count++;
    map.set(key, opt);
  }
  return sortOptions([...map.values()]);
}

function sortOptions(list: FacetOption[]): FacetOption[] {
  return list.sort((a, b) => {
    const au = a.key === UNKNOWN_BRAND_KEY || a.key === UNKNOWN_MODEL_KEY ? 1 : 0;
    const bu = b.key === UNKNOWN_BRAND_KEY || b.key === UNKNOWN_MODEL_KEY ? 1 : 0;
    return au - bu || b.count - a.count || a.label.localeCompare(b.label, "id");
  });
}

/** Jumlah per status GenieACS bila opsinya dipilih (dimensi lain tetap). */
export function genieacsCounts(
  onus: readonly DashboardOnu[],
  f: InventoryFilter,
  reg: ReadonlyMap<string, CpeMatch>,
): Record<GenieacsFilter, number> {
  let registered = 0;
  let unregistered = 0;
  for (const o of onus) {
    if (!matchesWith(o, f, reg, "genieacs")) continue;
    if (reg.has(o.id)) registered++;
    else unregistered++;
  }
  return { all: registered + unregistered, registered, unregistered };
}

export interface InventorySummary {
  total: number;
  online: number;
  offline: number;
  los: number;
  weak: number;
  registered: number | null;
  unregistered: number | null;
}

export function summarizeInventory(onus: readonly DashboardOnu[], reg: ReadonlyMap<string, CpeMatch> | null): InventorySummary {
  let online = 0;
  let offline = 0;
  let los = 0;
  let weak = 0;
  let registered = 0;
  for (const o of onus) {
    if (o.status === "online") online++;
    else if (o.status === "offline") offline++;
    else los++;
    if (o.rxPowerDbm !== null && o.rxPowerDbm < WEAK_RX_DBM) weak++;
    if (reg?.has(o.id)) registered++;
  }
  return {
    total: onus.length,
    online,
    offline,
    los,
    weak,
    registered: reg ? registered : null,
    unregistered: reg ? onus.length - registered : null,
  };
}

// ---------------------------------------------------------------------------
// Pendaftaran massal
// ---------------------------------------------------------------------------

/** Batas satu putaran massal: tiap modem bisa memutus PPPoE pelanggannya ±30 detik. */
export const BULK_MAX = 30;

export type BulkMethod = "web" | "olt";

export interface BulkEligibility {
  ok: boolean;
  /** Alasan ONU ini tidak bisa diproses dengan metode itu (kosong bila ok). */
  reason: string;
}

// Merek yang halaman web adminnya sudah dipetakan: C-Data FD511GW (OLT: CDTC), ZIMLINK ZL-2113X
// (OLT: HWTC H113) dan GGCLink GM220-S XPON (OLT: ZICG GM22).
const WEB_METHOD_BRANDS: ReadonlySet<string> = new Set(["CDTC", "ZIMLINK", "GGCLINK", "F609"]);

/**
 * Metode "web" (login ke halaman admin modem) baru dipetakan untuk FD511GW (OLT: CDTC),
 * ZIMLINK ZL-2113X (OLT: HWTC H113) dan GGCLink GM220-S XPON (OLT: ZICG GM22). Metode "olt" (ikat profil TR-069 lewat telnet OLT) tidak
 * bergantung merek tetapi butuh nomor PON/ONU nyata.
 */
export function bulkEligibility(o: DashboardOnu, method: BulkMethod, reg: ReadonlyMap<string, CpeMatch>): BulkEligibility {
  if (reg.has(o.id)) return { ok: false, reason: "Sudah terdaftar di GenieACS" };
  if (method === "olt") {
    return o.ponIndex === null || o.onuIndex === null
      ? { ok: false, reason: "Nomor PON/ONU tidak tersedia" }
      : { ok: true, reason: "" };
  }
  if (!WEB_METHOD_BRANDS.has(parseOnuModel(o.model).brandKey)) {
    return { ok: false, reason: "Metode web ONT baru mendukung C-Data (CDTC / FD511GW), ZIMLINK (H113), GGCLink (ZICG GM22) dan ZTE F609 (MTKc)" };
  }
  if (o.status !== "online") return { ok: false, reason: "ONU tidak online" };
  return { ok: true, reason: "" };
}
