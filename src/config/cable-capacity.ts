/**
 * Konfigurasi Standar Pemetaan Kapasitas Serat Optik ke Ketebalan & Warna
 *
 * Mengikuti standar industri ISP fiber optik FTTH:
 * - 48 Core (Backbone Utama Core Router - OLT): Warna Ungu, Tebal 5.0 px
 * - 24 Core (Feeder Utama Sentral - ODC): Warna Indigo, Tebal 4.0 px
 * - 16 Core (Feeder Distribusi ODC - ODP): Warna Cyan, Tebal 3.2 px
 * - 8 Core (Kabel Distribusi Antar Tiang/ODP): Warna Amber, Tebal 2.5 px
 * - 2 Core (Drop Optik Pelanggan): Warna Status (Hijau/Kuning/Merah), Tebal 1.8 px
 */

export interface CableCapacityTier {
  minCores: number;
  maxCores: number;
  label: string;
  category: "backbone" | "feeder" | "distribution" | "drop";
  color: string;
  haloColor?: string;
  baseWeight: number;
  dashArray?: string;
  description: string;
}

export const CABLE_CAPACITY_TIERS: CableCapacityTier[] = [
  {
    minCores: 48,
    maxCores: 144,
    label: "48+ Core (Backbone Utama)",
    category: "backbone",
    color: "#8b5cf6", // Ungu
    haloColor: "#c084fc",
    baseWeight: 5.0,
    dashArray: "8, 6",
    description:
      "Kabel backbone kapasitas tinggi penghubung Core Router ke OLT / Sentral.",
  },
  {
    minCores: 24,
    maxCores: 47,
    label: "24 Core (Feeder Utama)",
    category: "feeder",
    color: "#6366f1", // Indigo
    haloColor: "#a5b4fc",
    baseWeight: 4.0,
    dashArray: "7, 5",
    description: "Kabel feeder utama penghubung OLT ke kabinet distribusi ODC.",
  },
  {
    minCores: 12,
    maxCores: 23,
    label: "16 Core (Feeder Distribusi)",
    category: "feeder",
    color: "#06b6d4", // Cyan
    haloColor: "#67e8f9",
    baseWeight: 3.2,
    dashArray: undefined,
    description: "Kabel feeder distribusi penghubung ODC ke kotak pembagi ODP.",
  },
  {
    minCores: 4,
    maxCores: 11,
    label: "8 Core (Distribusi Cabang)",
    category: "distribution",
    color: "#f59e0b", // Amber
    haloColor: "#fde68a",
    baseWeight: 2.5,
    dashArray: "6, 4",
    description: "Kabel distribusi percabangan jalur tiang dan ODP sekunder.",
  },
  {
    minCores: 1,
    maxCores: 3,
    label: "1-2 Core (Drop Optik Pelanggan)",
    category: "drop",
    color: "#10b981", // Emerald (Online default)
    haloColor: "#6ee7b7",
    baseWeight: 1.8,
    dashArray: undefined,
    description:
      "Kabel drop wire 1-2 core dari kotak ODP ke modem ONU pelanggan.",
  },
];

export interface CableStyleOptions {
  coreCapacity: number;
  type?: "backbone" | "feeder" | "distribution" | "drop" | string;
  status?: "active" | "warning" | "offline" | "online" | string;
  isHighlighted?: boolean;
}

export interface ResolvedCableStyle {
  color: string;
  haloColor: string;
  baseWeight: number;
  dashArray?: string;
  opacity: number;
  label: string;
  category: string;
}

/**
 * Menentukan style visual konsisten (warna, ketebalan dasar, halo, dash) berdasarkan
 * kapasitas core, tipe segmen, status operasional, dan kondisi penyorotan.
 */
export function resolveCableCapacityStyle(
  options: CableStyleOptions,
): ResolvedCableStyle {
  const { coreCapacity, type, status, isHighlighted } = options;

  // 1. Temukan tingkatan berdasarkan coreCapacity atau fallback ke tipe
  let tier = CABLE_CAPACITY_TIERS.find(
    (t) => coreCapacity >= t.minCores && coreCapacity <= t.maxCores,
  );

  if (!tier) {
    if (type === "backbone") tier = CABLE_CAPACITY_TIERS[0];
    else if (type === "feeder") tier = CABLE_CAPACITY_TIERS[2];
    else if (type === "distribution") tier = CABLE_CAPACITY_TIERS[3];
    else tier = CABLE_CAPACITY_TIERS[4];
  }

  // 2. Warna dasar
  let color = tier.color;
  let haloColor = tier.haloColor || "#38bdf8";
  let baseWeight = tier.baseWeight;
  const dashArray = tier.dashArray;
  const opacity = 0.95;

  // 3. Modifikasi khusus kabel drop pelanggan sesuai kondisi telemetri
  if (tier.category === "drop" || type === "drop") {
    if (status === "offline") {
      color = "#ef4444"; // Merah
      haloColor = "#fca5a5";
    } else if (status === "warning") {
      color = "#f59e0b"; // Oranye / redaman buruk
      haloColor = "#fde68a";
    } else {
      color = "#10b981"; // Hijau / normal
      haloColor = "#6ee7b7";
    }
  }

  // 4. Modifikasi saat disorot (highlight)
  if (isHighlighted) {
    color = "#22d3ee"; // Neon Cyan
    haloColor = "#a5f3fc";
    baseWeight = baseWeight + 1.5;
  }

  return {
    color,
    haloColor,
    baseWeight,
    dashArray,
    opacity,
    label: tier.label,
    category: tier.category,
  };
}
