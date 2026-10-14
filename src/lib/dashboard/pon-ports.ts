// Data tiruan detail port PON. Pengganti sementara untuk GET /api/v1/olts/{id}/pon/{n}.
// Deterministik: id yang sama selalu menghasilkan data yang sama (tanpa Math.random/Date.now).
import {
  classifyOnuTrouble,
  summarizeOnuTroubles,
  type OnuTroubleEvaluation,
} from "./onu-trouble-classifier.ts";

export interface PonOnuDetail {
  onuIndex: number;
  /** null = ONU belum dipetakan ke pelanggan (data nyata dari DB). */
  customerName: string | null;
  pppoeUsername: string | null;
  address: string | null;
  ontModel: string | null;
  rxPowerDbm: number | null;
  txPowerDbm: number | null;
  /** los = fiber putus / redaman anjlok (tidak ada sinyal optik). */
  status: "online" | "offline" | "los";
  /** Format HSGQ... atau ZTEG... */
  serialNumber: string | null;
  /** Format AA:BB:CC:DD:EE:FF */
  macAddress: string | null;
  /** Jarak ONU dari OLT, meter; null bila belum diketahui. */
  distanceMeters: number | null;
  isWeak: boolean;
  /** Epoch detik: online = saat sinkronisasi; offline = terakhir terlihat online. */
  lastSeenAt: number;
  trouble?: OnuTroubleEvaluation;
  isTroubled?: boolean;
}

export interface PonPortDetail {
  id: string;
  oltName: string;
  oltHost: string;
  ponIndex: number;
  name: string;
  /** Kapasitas maksimum ONU per port PON. */
  capacity: number;
  status: "up" | "down";
  txPowerDbm: number | null;
  rxPowerDbm: number | null;
  attenuationDb: number | null;
  totalOnu: number;
  onlineOnu: number;
  /** Epoch detik sinkronisasi data optik (tetap, bukan Date.now, agar SSR = klien). */
  syncedAt: number;
  onus: PonOnuDetail[];
  troubleSummary?: ReturnType<typeof summarizeOnuTroubles>;
  troubledOnuCount?: number;
  /** Asal data; kosong dianggap mock. */
  source?: "db" | "mock";
}

const SYNCED_AT_EPOCH = 1_760_000_000;

/** Batas sinyal lemah; sama dengan filter di halaman CPE. */
export const WEAK_RX_DBM = -27;

const OLTS: Record<number, { name: string; host: string }> = {
  1: { name: "OLT-GPON-CORE-01", host: "10.10.0.10" },
  2: { name: "OLT-EPON-TIMUR-02", host: "10.10.1.20" },
  3: { name: "OLT-GPON-CADANGAN-03", host: "10.10.2.30" },
};

const FIRST = ["Budi", "Dewi", "Agus", "Siti", "Rudi", "Wati", "Joko", "Rina", "Eko", "Lestari", "Hendra", "Putri"];
const LAST = ["Santoso", "Wijaya", "Pratama", "Hidayat", "Kusuma", "Lubis", "Nugroho", "Saputra"];
const STREETS = ["Jl. Melati", "Jl. Mawar", "Jl. Kenanga", "Jl. Anggrek", "Jl. Dahlia", "Jl. Flamboyan"];
const MODELS = ["Huawei HG8245H5", "ZTE F609 v3", "Fiberhome AN5506-04", "ZTE F670L DualBand", "Huawei HG8145V5"];

/** PRNG kecil (mulberry32) dengan benih dari teks. */
function seeded(text: string): () => number {
  let h = 1779033703;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const hex = (rand: () => number, len: number) =>
  Array.from({ length: len }, () => Math.floor(rand() * 16).toString(16)).join("").toUpperCase();

export type ParsedPonId =
  | { kind: "mock"; oltNo: number; ponIndex: number }
  | { kind: "db"; oltId: string; ponIndex: number };

const MOCK_PON_ID = /^olt-(\d+)-pon-(\d+)$/;
const DB_PON_ID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::|-pon-)(\d+)$/;

/** Urai id port PON: mock `olt-<n>-pon-<n>` atau nyata `<uuid-olt>:<n>` / `<uuid-olt>-pon-<n>`. */
export function parsePonId(id: string): ParsedPonId | null {
  const mock = MOCK_PON_ID.exec(id);
  if (mock) return { kind: "mock", oltNo: Number(mock[1]), ponIndex: Number(mock[2]) };
  const db = DB_PON_ID.exec(id);
  if (db) return { kind: "db", oltId: db[1], ponIndex: Number(db[2]) };
  return null;
}

export function isValidPonId(id: string): boolean {
  return parsePonId(id) !== null;
}

/** Hanya id mock; id nyata (UUID) diselesaikan di server: pon-port-resolver.ts. */
export function getPonPortDetailOrNull(id: string): PonPortDetail | null {
  return parsePonId(id)?.kind === "mock" ? getMockPonPortDetail(id) : null;
}

export function getMockPonPortDetail(id: string): PonPortDetail {
  const m = /^olt-(\d+)-pon-(\d+)$/.exec(id);
  const oltNo = m ? Number(m[1]) : 1;
  const ponIndex = m ? Number(m[2]) : 1;
  const olt = OLTS[oltNo] ?? { name: `OLT-${String(oltNo).padStart(2, "0")}`, host: `10.10.${oltNo}.10` };
  const rand = seeded(`${oltNo}:${ponIndex}`);

  const txPowerDbm = round1(2 + rand() * 1.5);
  const total = 16 + Math.floor(rand() * 17); // 16..32
  const onus: PonOnuDetail[] = [];
  for (let i = 1; i <= total; i++) {
    // Setiap ONU ke-7 sinyal lemah (-27.5..-30); sisanya normal (-17..-25).
    const weak = i % 7 === 0;
    // Deterministik: setiap ONU ke-11 LOS (-38 dBm), setiap ke-5 (sisa 3) offline, ditambah acak ~12%.
    const los = i % 11 === 0;
    const rx = los ? -38 : round1(weak ? -27.5 - rand() * 2.5 : -17 - rand() * 8);
    const offline = !los && (i % 5 === 3 || rand() < 0.12);
    const unseen = los || offline;
    const first = FIRST[Math.floor(rand() * FIRST.length)];
    const last = LAST[Math.floor(rand() * LAST.length)];
    const status = los ? "los" : offline ? "offline" : "online";
    // Urutan pemanggilan rand() tetap seperti semula agar data mock deterministik tidak bergeser.
    const detail: PonOnuDetail = {
      onuIndex: i,
      customerName: `${first} ${last}`,
      pppoeUsername: `${first.toLowerCase()}.${last.toLowerCase()}${oltNo}${ponIndex}${i}`,
      address: `${STREETS[Math.floor(rand() * STREETS.length)]} No. ${1 + Math.floor(rand() * 60)}`,
      ontModel: MODELS[Math.floor(rand() * MODELS.length)],
      rxPowerDbm: rx,
      txPowerDbm: round1(1.5 + rand() * 1.5),
      status,
      serialNumber: `${rand() < 0.5 ? "HSGQ" : "ZTEG"}${hex(rand, 8)}`,
      macAddress: Array.from({ length: 6 }, () => hex(rand, 2)).join(":"),
      distanceMeters: 150 + Math.floor(rand() * 3351), // 150..3500
      isWeak: rx < WEAK_RX_DBM,
      lastSeenAt: unseen ? SYNCED_AT_EPOCH - 600 - Math.floor(rand() * 86_400) : SYNCED_AT_EPOCH,
    };
    const trouble = classifyOnuTrouble({
      status: detail.status,
      rxPowerDbm: detail.rxPowerDbm,
      distanceMeters: detail.distanceMeters,
    });
    onus.push({ ...detail, trouble, isTroubled: trouble.isTroubled });
  }

  const online = onus.filter((o) => o.status === "online");
  // Data mock selalu punya rxPowerDbm.
  const rxOf = (o: PonOnuDetail) => o.rxPowerDbm ?? 0;
  const avgRx = online.length
    ? online.reduce((s, o) => s + rxOf(o), 0) / online.length
    : onus.reduce((s, o) => s + rxOf(o), 0) / onus.length;

  const troubleSummary = summarizeOnuTroubles(
    onus.map((o) => ({ status: o.status, rxPowerDbm: o.rxPowerDbm, distanceMeters: o.distanceMeters })),
  );

  return {
    id,
    oltName: olt.name,
    oltHost: olt.host,
    ponIndex,
    name: `PON 1/1/${ponIndex}`,
    capacity: 128,
    status: "up",
    txPowerDbm,
    rxPowerDbm: round1(avgRx),
    attenuationDb: round1(txPowerDbm - avgRx),
    totalOnu: onus.length,
    onlineOnu: online.length,
    syncedAt: SYNCED_AT_EPOCH,
    onus,
    troubleSummary,
    troubledOnuCount: troubleSummary.troubled,
    source: "mock",
  };
}

export interface PonPortSummary {
  id: string; // `${oltId}-pon-${ponIndex}`
  oltId: string;
  oltName: string;
  ponIndex: number; // 1..totalPonPorts
  name: string; // "PON 1/1/1"
  status: "up" | "down";
  capacity: number; // 128 (GPON) / 64 (EPON)
  onuCount: number;
  onlineOnuCount: number;
  txPowerDbm: number;
  avgRxPowerDbm: number;
}

/** Ringkasan semua port PON satu OLT. Murni & deterministik dari oltId + ponIndex. */
export function getMockPonPorts(oltId: string, totalPonPorts = 8, oltName = "OLT HSGQ"): PonPortSummary[] {
  const capacity = /epon/i.test(oltId) ? 64 : 128;
  return Array.from({ length: Math.max(0, Math.floor(totalPonPorts)) }, (_, i) => {
    const ponIndex = i + 1;
    const rand = seeded(`${oltId}:${ponIndex}`);
    const down = rand() < 0.1;
    const onuCount = down ? 0 : Math.floor(capacity * (0.1 + rand() * 0.75));
    const onlineOnuCount = down ? 0 : Math.floor(onuCount * (0.8 + rand() * 0.2));
    return {
      id: `${oltId}-pon-${ponIndex}`,
      oltId,
      oltName,
      ponIndex,
      name: `PON 1/1/${ponIndex}`,
      status: down ? "down" : "up",
      capacity,
      onuCount,
      onlineOnuCount,
      txPowerDbm: round1(2 + rand() * 1.5),
      avgRxPowerDbm: round1(-17 - rand() * 10),
    };
  });
}
