// Papan trafik VLAN per PON, mode live: disusun dari telemetri yang didorong backend Go
// (laju dari counter /interface router + port PON dari database). Tidak ada permintaan
// berulang dan tidak ada angka perkiraan: titik grafik hanya ditambah saat backend
// mengirim laju yang benar-benar terhitung.
import type {
  VlanPonTrafficItem,
  VlanPonTrafficPoint,
  VlanPonTrafficSummary,
} from "@/services/vlan-traffic.service";
import type { Telemetry, VlanHistory } from "./telemetry";

// 300 titik = 5 menit pada 1 sampel per detik, sama dengan grafik traffic utama.
export const VLAN_LIVE_POINTS = 300;

const VLAN_PON = /^vlan110(\d)$/;

const clock = new Intl.DateTimeFormat("id-ID", {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Jakarta",
});

const round1 = (value: number) => Math.round(value * 10) / 10;

// `buffer` menyimpan titik tiap VLAN antar panggilan dan DIUBAH di sini.
export function buildLiveVlanSummary(
  telemetry: Telemetry,
  buffer: Map<string, VlanPonTrafficPoint[]>,
  nowMs: number,
): VlanPonTrafficSummary {
  const items: VlanPonTrafficItem[] = [];
  for (const v of telemetry.vlans) {
    const match = VLAN_PON.exec(v.name);
    if (!match) continue;
    const ponIndex = Number(match[1]);

    const series = buffer.get(v.name) ?? [];
    // Satu titik per pembacaan counter di router (waktu `at` dari backend), jadi sumbu
    // waktunya sama dengan grafik traffic utama (satu sampel per detik) dan pesan
    // telemetri lain (CPU, latensi, ...) tidak menambah titik.
    if (
      v.at !== null &&
      v.downMbps !== null &&
      v.upMbps !== null &&
      v.at > (series.at(-1)?.timestamp ?? 0)
    ) {
      series.push({
        timestamp: v.at,
        timeLabel: clock.format(new Date(v.at * 1000)),
        downloadMbps: round1(v.downMbps),
        uploadMbps: round1(v.upMbps),
      });
      if (series.length > VLAN_LIVE_POINTS)
        series.splice(0, series.length - VLAN_LIVE_POINTS);
    }
    buffer.set(v.name, series);

    const pon = telemetry.pons.find((p) => p.ponIndex === ponIndex);
    const dl = series.map((p) => p.downloadMbps);
    const ul = series.map((p) => p.uploadMbps);
    const avg = (values: number[]) =>
      values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    items.push({
      ponIndex,
      ponName: `PON ${ponIndex}`,
      vlanName: v.name,
      vlanId: Number(v.name.slice("vlan".length)),
      oltName: pon?.oltName ?? "",
      running: v.running,
      disabled: v.disabled,
      onuCount: pon?.onuOnline ?? 0,
      rxPowerDbm: pon?.rxPowerDbm ?? null,
      currentDownloadMbps: dl.at(-1) ?? 0,
      currentUploadMbps: ul.at(-1) ?? 0,
      peakDownloadMbps: Math.max(0, ...dl),
      peakUploadMbps: Math.max(0, ...ul),
      avgDownloadMbps: avg(dl),
      avgUploadMbps: avg(ul),
      // Counter byte kumulatif tidak dikirim; footer menyembunyikan total bila 0.
      rxTotalBytes: 0,
      txTotalBytes: 0,
      // Salinan: grafik digambar ulang menurut identitas larik, buffer diubah di tempat.
      series: series.slice(),
    });
  }
  items.sort((a, b) => a.ponIndex - b.ponIndex);

  return {
    polledAt: new Date(nowMs).toISOString(),
    mode: "live",
    range: "live",
    totalActivePon: items.filter((i) => i.running && i.onuCount > 0).length,
    totalOnuOnline: items.reduce((sum, i) => sum + i.onuCount, 0),
    totalDownloadMbps: items.reduce((sum, i) => sum + i.currentDownloadMbps, 0),
    totalUploadMbps: items.reduce((sum, i) => sum + i.currentUploadMbps, 0),
    items,
  };
}

// Mengisi buffer dari riwayat backend (GET /api/v1/dashboard/vlans/history) supaya grafik
// tidak mulai dari kosong setelah halaman dimuat ulang.
export function seedVlanBuffer(
  buffer: Map<string, VlanPonTrafficPoint[]>,
  history: VlanHistory[],
) {
  for (const h of history) {
    const points = h.samples.slice(-VLAN_LIVE_POINTS).map((s) => ({
      timestamp: s.at,
      timeLabel: clock.format(new Date(s.at * 1000)),
      downloadMbps: round1(s.downMbps),
      uploadMbps: round1(s.upMbps),
    }));
    buffer.set(h.name, points);
  }
}
