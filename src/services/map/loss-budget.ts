// Hitungan redaman (loss budget) FTTH dari OLT sampai ODP/pelanggan. Logika murni, diuji di
// tests/loss-budget.test.mjs dan dipakai juga server untuk memvalidasi rasio splitter.
import { haversineDistanceM } from "./geo.ts";
import type { CableSegment, MapCustomer, MapDevice } from "./types.ts";

/** Rasio splitter yang boleh dipilih (1:N, nilai N) */
export const SPLITTER_RATIOS = { odc: [4, 8, 16], odp: [4, 8] } as const;

// Redaman splitter PLC tipikal (dB) per rasio 1:N
const SPLITTER_LOSS_DB: Record<number, number> = { 2: 3.7, 4: 7.3, 8: 10.5, 16: 13.7, 32: 17.1, 64: 20.5 };
export const FIBER_DB_PER_KM = 0.35;
export const CONNECTOR_DB = 0.25; // per konektor SC/UPC
export const SPLICE_DB = 0.1; // per sambungan fusion di tiap kotak
// shortcut: Tx OLT tidak tersedia dari pusat; asumsi SFP GPON kelas C+ (+5 dBm). Ganti bila Tx per port PON sudah ada
export const OLT_TX_DBM = 5;
/** Rentang Rx ONU yang sehat (dBm) */
export const RX_IDEAL = { min: -24, max: -15 } as const;

/** Splitter rasio (coupler FBT tak seimbang) yang boleh dipilih: persen port tap, mis. 10 = 10:90 */
export const TAP_RATIOS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 18, 20, 22, 25, 28, 30, 35, 40, 45, 50] as const;

// Redaman FBT single-mode tanpa konektor dari datasheet (FS.com 1/99, 5/95, 10/90, 50/50; Bazis grade P 20/80):
// [persen tap, dB port tap, dB port lewat]
const FBT_DATASHEET: [number, number, number][] = [
  [1, 21.5, 0.2],
  [5, 14.2, 0.4],
  [10, 11.0, 0.65],
  [20, 7.6, 1.2],
  [50, 3.4, 3.4],
];
const theoryDb = (pct: number) => -10 * Math.log10(pct / 100);

/** Redaman port tap & port lewat splitter rasio. Di titik datasheet persis datasheet; di antaranya
 * teori -10·log10(p) + kelebihan redaman (excess) yang diinterpolasi dari titik datasheet. */
export function couplerLossDb(tapPct: number): { tap: number; pass: number } {
  const p = Math.min(50, Math.max(1, tapPct));
  const i = Math.max(0, FBT_DATASHEET.findIndex(([pct]) => pct >= p) - 1);
  const [a, aTap, aPass] = FBT_DATASHEET[i];
  const [b, bTap, bPass] = FBT_DATASHEET[Math.min(i + 1, FBT_DATASHEET.length - 1)];
  const f = b === a ? 0 : (p - a) / (b - a);
  const excess = (ea: number, eb: number) => ea + (eb - ea) * f;
  return {
    tap: round(theoryDb(p) + excess(aTap - theoryDb(a), bTap - theoryDb(b))),
    pass: round(theoryDb(100 - p) + excess(aPass - theoryDb(100 - a), bPass - theoryDb(100 - b))),
  };
}

/** Jumlah port output ODC/ODP: rasio splitter bila diisi, selain itu kapasitas */
export const portCount = (d: MapDevice) => d.splitterRatio ?? d.capacity ?? 0;

/** Port pelanggan di kotak: ODP = port splitter-nya; ODC = kapasitas (port splitter ODC dipakai ODP) */
export const customerPortCount = (d: MapDevice) => (d.type === "odc" ? d.capacity ?? 0 : portCount(d));

/** Pemakaian port kotak: ODP = pelanggan / port pelanggan, ODC = ODP di bawahnya / port splitter.
 * null = bukan ODP/ODC atau jumlah port belum diketahui. */
export function capacityUse(d: MapDevice, devices: MapDevice[]): { used: number; total: number } | null {
  const total = d.type === "odp" ? customerPortCount(d) : d.type === "odc" ? portCount(d) : 0;
  if (total <= 0) return null;
  const used =
    d.type === "odp"
      ? (d.connectedCustomersCount ?? 0)
      : devices.filter((x) => x.parentDeviceId === d.id && x.type === "odp").length;
  return { used, total };
}

/** Rasio tak lazim dibulatkan ke splitter terdekat di atasnya (1:12 dihitung 1:16) */
export const splitterLossDb = (ratio: number) =>
  SPLITTER_LOSS_DB[2 ** Math.ceil(Math.log2(Math.max(2, ratio)))] ?? SPLITTER_LOSS_DB[64];

export interface CablePath {
  /** Dari sumber (biasanya OLT) sampai perangkat awal */
  nodes: MapDevice[];
  /** links[i] = kabel antara nodes[i] dan nodes[i+1] */
  links: { lengthM: number; estimated: boolean }[];
}

const straightM = (a: { latitude: number | null; longitude: number | null }, b: MapDevice) =>
  a.latitude != null && a.longitude != null
    ? haversineDistanceM(b.latitude, b.longitude, a.latitude, a.longitude)
    : 0;

// Naik dari perangkat ke sumber lewat induk yang dicatat (ODP -> ODC -> OLT); perangkat tanpa induk
// ikut kabel yang masuk. Jarak tiap lompatan dari kabel yang menyambung keduanya (lewat tiang dsb.),
// atau garis lurus bila kabelnya tidak sampai ke induk.
export function upstreamPath(startId: string, devices: MapDevice[], segments: CableSegment[]): CablePath {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const incoming = (id: string) => segments.find((s) => s.toDeviceId === id && !s.customerId);
  const cableBetween = (child: MapDevice, parent: MapDevice) => {
    let lengthM = 0;
    const seen = new Set<string>();
    for (let at = child.id; at !== parent.id; ) {
      const seg = incoming(at);
      if (!seg || seen.has(seg.fromDeviceId)) return { lengthM: straightM(child, parent), estimated: true };
      seen.add(seg.fromDeviceId);
      lengthM += seg.lengthM;
      at = seg.fromDeviceId;
    }
    return { lengthM, estimated: false };
  };

  const start = byId.get(startId);
  if (!start) return { nodes: [], links: [] };
  const nodes = [start];
  const links: CablePath["links"] = [];
  for (let cur = start; ; ) {
    const up = byId.get(cur.parentDeviceId ?? incoming(cur.id)?.fromDeviceId ?? "");
    if (!up || nodes.includes(up)) break;
    links.unshift(cableBetween(cur, up));
    nodes.unshift(up);
    cur = up;
  }
  return { nodes, links };
}

/** Kabel drop pelanggan: segmen yang berakhir di pelanggan, atau garis lurus dari ODP-nya */
export function customerDrop(customer: MapCustomer, devices: MapDevice[], segments: CableSegment[]) {
  const seg = segments.find((s) => s.customerId === customer.id);
  const odp = devices.find((d) => d.id === (seg ? seg.fromDeviceId : customer.odpId));
  if (!odp) return null;
  return { odp, lengthM: seg ? seg.lengthM : straightM(customer, odp), estimated: !seg };
}

export interface BudgetStep {
  kind: "source" | "fiber" | "splitter" | "onu";
  label: string;
  detail: string;
  lossDb: number;
  /** Daya setelah langkah ini */
  powerDbm: number;
  /** Jenis perangkat untuk ikon (sumber/splitter) */
  deviceType?: MapDevice["type"];
  warn?: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

// Rantai redaman: Tx OLT -> (kabel -> kotak splitter)* -> [kabel drop -> ONU]
export function lossBudget(path: CablePath, drop?: { lengthM: number; estimated: boolean }) {
  const steps: BudgetStep[] = [];
  let power = OLT_TX_DBM;
  const push = (s: Omit<BudgetStep, "powerDbm">) => {
    power -= s.lossDb;
    steps.push({ ...s, lossDb: round(s.lossDb), powerDbm: round(power) });
  };
  const fiber = (label: string, l: { lengthM: number; estimated: boolean }) =>
    push({
      kind: "fiber",
      label,
      detail: `${(l.lengthM / 1000).toFixed(2)} km × ${FIBER_DB_PER_KM} dB/km`,
      lossDb: (l.lengthM / 1000) * FIBER_DB_PER_KM,
      warn: l.estimated ? "Kabel belum digambar, panjang dari garis lurus" : undefined,
    });

  const source = path.nodes[0];
  const complete = source?.type === "server";
  push({
    kind: "source",
    label: source?.name ?? "OLT",
    deviceType: source?.type,
    detail: `Tx +${OLT_TX_DBM} dBm (asumsi) − konektor ${CONNECTOR_DB} dB`,
    lossDb: CONNECTOR_DB,
    warn: complete ? undefined : "Jalur belum tersambung sampai OLT",
  });
  path.links.forEach((link, i) => {
    const node = path.nodes[i + 1];
    const next = path.nodes[i + 2];
    fiber("Kabel", link);
    if (node.type !== "odc" && node.type !== "odp") return; // tiang/server tidak memecah daya
    const ratio = node.splitterRatio;
    const tap = node.splitterTap ? couplerLossDb(node.splitterTap) : null;
    const tapLabel = node.splitterTap ? `${node.splitterTap}:${100 - node.splitterTap}` : "";
    const boxDb = 2 * CONNECTOR_DB + SPLICE_DB;
    const box = `konektor/sambungan ${round(boxDb)} dB`;
    // Jalur berantai: kotak dengan splitter rasio meneruskan ke perangkat berikutnya lewat port "lewat",
    // kecuali perangkat itu dipasang di port ODC (keluar lewat splitter PLC kotak ini)
    const passThrough = next && tap && !(node.type === "odc" && next.odcPort != null);
    if (passThrough) {
      push({
        kind: "splitter",
        label: `${node.name} (lewat ${tapLabel})`,
        deviceType: node.type,
        detail: `Splitter rasio ${tapLabel} port ${100 - node.splitterTap!}% ${tap.pass} dB + ${box}`,
        lossDb: tap.pass + boxDb,
      });
      return;
    }
    const parts = [
      tap && `Splitter rasio ${tapLabel} port ${node.splitterTap}% ${tap.tap} dB`,
      ratio && `Splitter 1:${ratio} ${splitterLossDb(ratio)} dB`,
      box,
    ].filter(Boolean);
    push({
      kind: "splitter",
      label: `${node.name}${tap ? ` (${tapLabel})` : ""}${ratio ? ` (1:${ratio})` : ""}`,
      deviceType: node.type,
      detail: parts.join(" + ").replace(/^k/, "K"),
      lossDb: (tap ? tap.tap : 0) + (ratio ? splitterLossDb(ratio) : 0) + boxDb,
      warn: ratio ? undefined : "Rasio splitter belum diisi, redaman splitter belum dihitung",
    });
  });
  if (drop) {
    fiber("Kabel drop", drop);
    push({ kind: "onu", label: "ONU pelanggan", detail: `Konektor ${CONNECTOR_DB} dB`, lossDb: CONNECTOR_DB });
  }
  return {
    steps,
    totalLossDb: round(OLT_TX_DBM - power),
    rxDbm: round(power),
    complete: complete && steps.every((s) => !s.warn || s.kind === "fiber"),
  };
}
