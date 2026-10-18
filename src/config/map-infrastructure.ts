/**
 * Konfigurasi Ikon, Warna, dan Simbol Visual Tiap Jenis Infrastruktur Jaringan
 * Standardisasi pembeda visual untuk: Router, OLT, ODC, ODP, dan Tiang.
 */

import type { InfrastructureDeviceType } from "@/validators/infrastructure-placement";

export interface InfrastructureVisualConfig {
  type: InfrastructureDeviceType;
  label: string;
  shortLabel: string;
  color: string;
  haloColor: string;
  badgeClass: string;
  emoji: string;
  radius: number;
  iconSvg: string;
  description: string;
}

export const INFRASTRUCTURE_DEVICE_CONFIG: Record<
  InfrastructureDeviceType,
  InfrastructureVisualConfig
> = {
  router: {
    type: "router",
    label: "Core Router BGP Gateway",
    shortLabel: "Router Core",
    color: "#8b5cf6", // Violet
    haloColor: "rgba(139, 92, 246, 0.22)",
    badgeClass: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30",
    emoji: "🖧",
    radius: 12,
    description: "Gateway BGP, PPPoE Server, Routing Core",
    iconSvg: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6.01 18h.01"/><path d="M10.01 18h.01"/><path d="M15 10v4"/><path d="M17.84 7.17a4 4 0 0 0-5.66 0"/><path d="M20.66 4.34a8 8 0 0 0-11.31 0"/></svg>`,
  },
  olt: {
    type: "olt",
    label: "Optical Line Terminal",
    shortLabel: "OLT Fiber",
    color: "#06b6d4", // Cyan
    haloColor: "rgba(6, 182, 212, 0.22)",
    badgeClass: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30",
    emoji: "📡",
    radius: 10,
    description: "Optical Line Terminal HSGQ GPON/EPON",
    iconSvg: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg>`,
  },
  odc: {
    type: "odc",
    label: "Optical Distribution Cabinet",
    shortLabel: "ODC Feeder",
    color: "#3b82f6", // Blue
    haloColor: "rgba(59, 130, 246, 0.22)",
    badgeClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
    emoji: "🗄️",
    radius: 9,
    description: "Kabinet Feeder Sentral Serat Optik",
    iconSvg: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>`,
  },
  odp: {
    type: "odp",
    label: "Optical Distribution Point",
    shortLabel: "ODP Kotak",
    color: "#f59e0b", // Amber
    haloColor: "rgba(245, 158, 11, 0.22)",
    badgeClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    emoji: "📦",
    radius: 8,
    description: "Kotak Distribusi Fiber ke Rumah Pelanggan",
    iconSvg: `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`,
  },
  pole: {
    type: "pole",
    label: "Tiang Lintasan Fiber",
    shortLabel: "Tiang Fiber",
    color: "#64748b", // Slate
    haloColor: "rgba(100, 116, 139, 0.22)",
    badgeClass: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/30",
    emoji: "📍",
    radius: 7,
    description: "Tiang Tumpu Kabel Aerial Serat Optik",
    iconSvg: `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/></svg>`,
  },
};

export function getInfrastructureDeviceStyle(
  type: string | null | undefined,
): InfrastructureVisualConfig {
  const normalized = (type?.toLowerCase() ?? "pole") as InfrastructureDeviceType;
  return (
    INFRASTRUCTURE_DEVICE_CONFIG[normalized] ?? INFRASTRUCTURE_DEVICE_CONFIG.pole
  );
}
