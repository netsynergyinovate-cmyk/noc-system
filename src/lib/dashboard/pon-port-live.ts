import { fetchLiveOlts, OltLoadError } from "./olt-live.ts";
import type { DashboardOnu } from "./onus.ts";
import { WEAK_RX_DBM } from "./onus.ts";
import type { PonPortOverviewRow } from "./pon-port-table-data.ts";
import type { PonPortSummary } from "./pon-ports.ts";

// Ringkasan semua port PON NYATA: port dari tabel olt_pon_ports lewat
// GET /api/olts/{id}/pon, dihitung bersama ONU nyata (olt_onus) untuk jumlah
// sinyal lemah dan LOS. Tidak ada data tiruan.

export interface LivePonOverview {
  rows: PonPortOverviewRow[];
  // Nama OLT yang daftar port-nya gagal dimuat (OLT lain tetap tampil).
  failedOlts: string[];
}

const ponOf = (ponPort: string): number | null => {
  const m = /^PON (\d+):/.exec(ponPort);
  return m ? Number(m[1]) : null;
};

// OLT yang belum punya pembacaan optik melaporkan 0 dBm (bukan null) untuk
// port. Nol pada RX dan TX sekaligus bukan pembacaan nyata, jadi dianggap kosong.
const reading = (rx: number, tx: number) =>
  rx === 0 && tx === 0 ? { rx: null, tx: null } : { rx, tx };

// Murni: gabungkan port satu OLT dengan ONU-nya.
export function buildPonRows(
  oltId: string,
  oltName: string,
  ports: readonly PonPortSummary[],
  onus: readonly DashboardOnu[],
): PonPortOverviewRow[] {
  return ports.map((p) => {
    const mine = onus.filter((o) => o.oltId === oltId && ponOf(o.ponPort) === p.ponIndex);
    const { rx, tx } = reading(p.avgRxPowerDbm, p.txPowerDbm);
    const totalOnu = Math.max(mine.length, p.onuCount);
    const onlineOnu = mine.length > 0 ? mine.filter((o) => o.status === "online").length : p.onlineOnuCount;
    const weakOnuCount = mine.filter(
      (o) => o.status === "online" && o.rxPowerDbm !== null && o.rxPowerDbm < WEAK_RX_DBM,
    ).length;
    // Aturan yang sama dengan tabel demo: port mati atau RX < -27 kritis; RX < -24
    // atau 4 ONU lemah atau lebih peringatan. Tanpa pembacaan tidak dinilai buruk.
    const opticalStatus: PonPortOverviewRow["opticalStatus"] =
      p.status === "down" || (rx !== null && rx < -27)
        ? "critical"
        : (rx !== null && rx < -24) || weakOnuCount >= 4
          ? "warning"
          : "normal";
    return {
      portId: `${oltId}:${p.ponIndex}`,
      oltId,
      oltName,
      ponIndex: p.ponIndex,
      name: p.name,
      status: p.status,
      totalOnu,
      onlineOnu,
      weakOnuCount,
      losOnuCount: mine.filter((o) => o.status === "los").length,
      capacityPercent: p.capacity > 0 ? Math.min(100, Math.round((totalOnu / p.capacity) * 100)) : 0,
      rxPowerDbm: rx,
      txPowerDbm: tx,
      opticalStatus,
    };
  });
}

export async function fetchLivePonOverview(onus: readonly DashboardOnu[]): Promise<LivePonOverview> {
  const olts = await fetchLiveOlts();
  const rows: PonPortOverviewRow[] = [];
  const failedOlts: string[] = [];
  await Promise.all(
    olts.map(async (olt) => {
      try {
        const res = await fetch(`/api/olts/${encodeURIComponent(olt.id)}/pon`);
        if (!res.ok) throw new OltLoadError(`HTTP ${res.status}`);
        const json = (await res.json()) as { data?: PonPortSummary[] };
        rows.push(...buildPonRows(olt.id, olt.name, json.data ?? [], onus));
      } catch {
        failedOlts.push(olt.name);
      }
    }),
  );
  rows.sort((a, b) => a.oltName.localeCompare(b.oltName) || a.ponIndex - b.ponIndex);
  return { rows, failedOlts };
}
