// Data tiruan tabel port PON lintas OLT + daftar ONU ringkas. Murni (tanpa server-only),
// deterministik. TIRUAN SEMENTARA: wajib dialihkan ke driver OLT nyata di Fase 5.
import { getMockPonPortDetail } from "./pon-ports.ts";

export interface PonPortOverviewRow {
  portId: string;
  oltId: string;
  oltName: string;
  ponIndex: number;
  name: string;
  status: "up" | "down";
  totalOnu: number;
  onlineOnu: number;
  weakOnuCount: number;
  losOnuCount: number;
  capacityPercent: number;
  rxPowerDbm: number | null;
  txPowerDbm: number | null;
  opticalStatus: "normal" | "warning" | "critical";
}

export interface PonPortFilter {
  oltId: string | "all";
  status: "up" | "down" | "all";
  opticalStatus: "normal" | "warning" | "critical" | "all";
  query: string;
}

export const PON_ONU_DATA_MOCK_ENTRY = {
  id: "pon-ports-onus-data",
  module: "Port PON & Daftar ONU",
  targetDevice: "OLT HSGQ / ZTE CLI & Web API",
  status: "dummy" as const,
  readPath:
    "src/services/devices.service.ts (getOltPonPorts, getOltPonPort, listOnus)",
  writePath: "POST /api/onus/{id}/map",
  envKey: "OLT_HSGQ_HOST",
  notes:
    "Tiruan sementara data port PON, ONU, redaman optik; wajib dialihkan ke backend nyata saat go-live Fase 5",
};

export const EMPTY_PON_FILTER: PonPortFilter = {
  oltId: "all",
  status: "all",
  opticalStatus: "all",
  query: "",
};

const OLT_COUNT = 3;
const PORTS_PER_OLT = 8;
/** OLT-2 bertipe EPON (64 ONU/port); lainnya GPON (128). */
const capacityOf = (oltNo: number) => (oltNo === 2 ? 64 : 128);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function generateMockPonPortOverview(): PonPortOverviewRow[] {
  const rows: PonPortOverviewRow[] = [];
  for (let oltNo = 1; oltNo <= OLT_COUNT; oltNo++) {
    for (let ponIndex = 1; ponIndex <= PORTS_PER_OLT; ponIndex++) {
      const portId = `olt-${oltNo}-pon-${ponIndex}`;
      const d = getMockPonPortDetail(portId);
      // Beberapa port sengaja DOWN agar filter bisa diuji (oltNo + ponIndex = 9).
      const down = oltNo + ponIndex === 9;
      const total = d.totalOnu;
      const weak = down
        ? 0
        : d.onus.filter((o) => o.isWeak && o.status !== "los").length;
      const los = down
        ? total
        : d.onus.filter((o) => o.status === "los").length;
      const rx = down ? null : d.rxPowerDbm;
      const tx = down ? null : d.txPowerDbm;
      const optical: PonPortOverviewRow["opticalStatus"] =
        down || rx == null || rx < -27
          ? "critical"
          : rx < -24 || weak >= 4
            ? "warning"
            : "normal";
      rows.push({
        portId,
        oltId: `olt-${oltNo}`,
        oltName: d.oltName,
        ponIndex,
        name: d.name,
        status: down ? "down" : "up",
        totalOnu: total,
        onlineOnu: down ? 0 : d.onlineOnu,
        weakOnuCount: weak,
        losOnuCount: los,
        capacityPercent: round1((total / capacityOf(oltNo)) * 100),
        rxPowerDbm: rx,
        txPowerDbm: tx,
        opticalStatus: optical,
      });
    }
  }
  return rows;
}

export function filterPonPorts(
  ports: PonPortOverviewRow[],
  filter: PonPortFilter,
): PonPortOverviewRow[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return ports.filter((p) => {
    if (filter.oltId !== "all" && p.oltId !== filter.oltId) return false;
    if (filter.status !== "all" && p.status !== filter.status) return false;
    if (
      filter.opticalStatus !== "all" &&
      p.opticalStatus !== filter.opticalStatus
    )
      return false;
    const hay = `${p.name} ${p.oltName} ${p.portId}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function computePonSummary(ports: PonPortOverviewRow[]): {
  totalPorts: number;
  upPorts: number;
  totalOnu: number;
  onlineOnu: number;
  weakOnu: number;
  losOnu: number;
} {
  return ports.reduce(
    (s, p) => ({
      totalPorts: s.totalPorts + 1,
      upPorts: s.upPorts + (p.status === "up" ? 1 : 0),
      totalOnu: s.totalOnu + p.totalOnu,
      onlineOnu: s.onlineOnu + p.onlineOnu,
      weakOnu: s.weakOnu + p.weakOnuCount,
      losOnu: s.losOnu + p.losOnuCount,
    }),
    {
      totalPorts: 0,
      upPorts: 0,
      totalOnu: 0,
      onlineOnu: 0,
      weakOnu: 0,
      losOnu: 0,
    },
  );
}
