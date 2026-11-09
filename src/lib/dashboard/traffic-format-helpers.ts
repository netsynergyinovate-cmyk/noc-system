// Helper format angka trafik (murni, tanpa efek samping). Satu aturan untuk
// semua papan: titik sebagai desimal, 2 desimal, spasi sebelum satuan.
// Bandwidth memakai basis 1000 (standar jaringan); volume data basis 1024.

export type BandwidthUnit = "auto" | "bps" | "kbps" | "mbps" | "gbps";

const BW_UNITS = [
  { key: "bps", label: "bps", div: 1 },
  { key: "kbps", label: "Kbps", div: 1e3 },
  { key: "mbps", label: "Mbps", div: 1e6 },
  { key: "gbps", label: "Gbps", div: 1e9 },
] as const;

const safe = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function formatBandwidthRate(
  bps: number,
  unit: BandwidthUnit = "auto",
): string {
  const v = safe(bps);
  let u: (typeof BW_UNITS)[number] = BW_UNITS[0];
  if (unit === "auto") {
    for (const c of BW_UNITS) if (v >= c.div) u = c;
  } else {
    u = BW_UNITS.find((c) => c.key === unit) ?? BW_UNITS[0];
  }
  const x = v / u.div;
  return `${Number.isInteger(x) ? x : x.toFixed(2)} ${u.label}`;
}

const VOLUME_UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatDataVolume(bytes: number): string {
  let v = safe(bytes);
  let i = 0;
  while (v >= 1024 && i < VOLUME_UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${Math.round(v)} B` : `${v.toFixed(2)} ${VOLUME_UNITS[i]}`;
}

export function formatPacketCount(packets: number): string {
  const n = Math.round(safe(packets));
  return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} paket`;
}

export function formatTrafficDuration(seconds: number): string {
  const s = Math.floor(safe(seconds));
  if (s < 1) return "< 1 dtk";
  if (s < 60) return `${s} dtk`;
  const join = (a: number, an: string, b: number, bn: string) =>
    b > 0 ? `${a} ${an} ${b} ${bn}` : `${a} ${an}`;
  if (s < 3600) return join(Math.floor(s / 60), "mnt", s % 60, "dtk");
  if (s < 86_400) {
    return join(
      Math.floor(s / 3600),
      "jam",
      Math.floor((s % 3600) / 60),
      "mnt",
    );
  }
  return join(
    Math.floor(s / 86_400),
    "hari",
    Math.floor((s % 86_400) / 3600),
    "jam",
  );
}

export function formatPercentage(value: number, decimals = 1): string {
  const v = Number.isFinite(value) ? value : 0;
  return `${v.toFixed(Math.min(10, Math.max(0, Math.floor(decimals))))}%`;
}
