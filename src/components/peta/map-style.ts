import { House, Network, Server, Split, UtilityPole, type LucideIcon } from "lucide-react";
import type { MapDevice } from "@/services/map/types";

// Isi SVG (viewBox 24, garis) ikon lucide yang sama dengan komponen di bawah, untuk penanda Leaflet (HTML string)
const SVG_BODY = {
  server:
    '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  odc: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/>',
  odp: '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>',
  pole: '<path d="M12 2v20"/><path d="M2 5h20"/><path d="M3 3v2"/><path d="M7 3v2"/><path d="M17 3v2"/><path d="M21 3v2"/><path d="m19 5-7 7-7-7"/>',
  customer:
    '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
} as const;

// Satu sumber untuk penanda peta, panel detail, dan panduan; tanpa kuning/merah/hijau (dipesan untuk status)
export const DEVICE_TYPE_STYLE: Record<
  MapDevice["type"],
  { color: string; label: string; name: string; Icon: LucideIcon }
> = {
  server: { color: "#6366f1", label: "S", name: "Server / OLT", Icon: Server },
  odc: { color: "#0891b2", label: "C", name: "ODC", Icon: Network },
  odp: { color: "#c026d3", label: "D", name: "ODP", Icon: Split },
  pole: { color: "#71717a", label: "T", name: "Tiang", Icon: UtilityPole },
};
export const CustomerIcon = House;

/** Lencana peringatan di pojok penanda: status pelanggan bermasalah dan kotak penuh */
export const MARKER_ALERT = {
  loss: { text: "!", color: "#ef4444", label: "Loss / Gangguan" },
  isolir: { text: "$", color: "#eab308", label: "Isolir" },
  offline: { text: "×", color: "#71717a", label: "Offline" },
  full: { text: "PENUH", color: "#ef4444", label: "Penuh" },
} as const;

/** HTML penanda peta: lencana berwarna dengan ikon putih (perangkat kotak membulat, pelanggan bulat),
 * opsional dengan lencana peringatan di pojok kanan atas */
export function markerIconHtml(
  kind: MapDevice["type"] | "customer",
  color: string,
  size: number,
  alert?: { text: string; color: string },
): string {
  const radius = kind === "customer" ? "50%" : "8px";
  const glyph = Math.round(size * 0.58);
  const badge = alert
    ? `<span style="position:absolute;top:-7px;right:-7px;min-width:15px;height:15px;padding:0 3px;border-radius:8px;background:${alert.color};border:1.5px solid #fff;color:#fff;font:700 9px/12px system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.5)">${alert.text}</span>`
    : "";
  return `<div style="position:relative;width:${size}px;height:${size}px;border-radius:${radius};background:${color};border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center"><svg xmlns="http://www.w3.org/2000/svg" width="${glyph}" height="${glyph}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${SVG_BODY[kind]}</svg>${badge}</div>`;
}

export const DEVICE_STATUS_LABEL: Record<MapDevice["status"], string> = {
  normal: "Normal",
  warning: "Peringatan",
  critical: "Kritis",
  offline: "Offline",
};

// Status sambungan ODP ↔ pelanggan (PRD): kuning isolir, merah loss, hijau terhubung, abu belum diketahui.
// flow = kelas animasi alir di globals.css; loss tanpa alir (putus).
export const CONNECTION_STYLE = {
  terhubung: { color: "#22c55e", label: "Terhubung", flow: "map-flow" },
  isolir: { color: "#eab308", label: "Isolir", flow: "map-flow map-flow-slow" },
  loss: { color: "#ef4444", label: "Loss / Terputus", flow: "map-flow-off" },
  unknown: { color: "#94a3b8", label: "Status belum tersedia", flow: "map-flow-off" },
} as const;

export function connectionStyle(status: string | null | undefined) {
  return status && status in CONNECTION_STYLE
    ? CONNECTION_STYLE[status as keyof typeof CONNECTION_STYLE]
    : CONNECTION_STYLE.unknown;
}

// Warna pilihan jalur (PRD: kuning/merah/hijau dipesan untuk status, jadi tidak ada di sini)
export const ROUTE_COLORS = [
  { value: "#3b82f6", name: "Biru" },
  { value: "#6366f1", name: "Nila" },
  { value: "#a855f7", name: "Ungu" },
  { value: "#06b6d4", name: "Sian" },
  { value: "#ea580c", name: "Jingga" },
  { value: "#78350f", name: "Cokelat" },
  { value: "#64748b", name: "Abu" },
  { value: "#f8fafc", name: "Putih" },
] as const;

export const FIBER_CAPACITY_OPTIONS = [
  { value: 1, label: "1 Core (Dropcore)" },
  { value: 2, label: "2 Core" },
  { value: 4, label: "4 Core" },
  { value: 8, label: "8 Core" },
  { value: 12, label: "12 Core" },
  { value: 24, label: "24 Core (Distribution)" },
  { value: 48, label: "48 Core (Feeder)" },
  { value: 96, label: "96 Core (Backbone)" },
] as const;

// Palet kapasitas serat: biru/nila/jingga/abu/cokelat/putih saja (kuning/merah/hijau = status)
export const CAPACITY_TIERS = [
  { maxCore: 2, color: "#e2e8f0", weight: 2, label: "1 – 2 Core (Dropcore)" },
  { maxCore: 6, color: "#64748b", weight: 3, label: "4 – 6 Core" },
  { maxCore: 12, color: "#3b82f6", weight: 4, label: "8 – 12 Core" },
  { maxCore: 24, color: "#6366f1", weight: 5, label: "24 Core (Distribusi)" },
  { maxCore: 48, color: "#ea580c", weight: 6, label: "48 Core (Feeder)" },
  { maxCore: Infinity, color: "#78350f", weight: 7, label: "96+ Core (Backbone)" },
] as const;

export function capacityStyle(fiberCapacity: number) {
  return (
    CAPACITY_TIERS.find((t) => fiberCapacity <= t.maxCore) ??
    CAPACITY_TIERS[CAPACITY_TIERS.length - 1]
  );
}
