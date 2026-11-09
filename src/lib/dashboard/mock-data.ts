import type { DashboardCustomer, DashboardRouter } from "./types";

// Data tiruan untuk fase frontend. Dibuat dari seed tetap supaya HTML server
// dan browser identik. Akan diganti data dari backend pada fase berikutnya.

export const CUSTOMER_COUNT = 100;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  "Budi",
  "Siti",
  "Agus",
  "Dewi",
  "Eko",
  "Rina",
  "Hendra",
  "Wati",
  "Joko",
  "Lestari",
  "Andi",
  "Sri",
  "Bambang",
  "Fitri",
  "Dedi",
  "Yuni",
  "Rizky",
  "Putri",
  "Ahmad",
  "Nur",
  "Fajar",
  "Maya",
  "Irfan",
  "Ratna",
];

const LAST_NAMES = [
  "Santoso",
  "Wijaya",
  "Pratama",
  "Hidayat",
  "Saputra",
  "Lestari",
  "Nugroho",
  "Kusuma",
  "Rahman",
  "Setiawan",
  "Utami",
  "Firmansyah",
  "Permana",
  "Maulana",
  "Hakim",
  "Susanto",
];

const STREETS = [
  "Jl. Mawar",
  "Jl. Melati",
  "Jl. Kenanga",
  "Jl. Anggrek",
  "Jl. Dahlia",
  "Jl. Cempaka",
  "Jl. Flamboyan",
  "Jl. Kamboja",
  "Jl. Teratai",
  "Jl. Seruni",
];

const PLANS_MBPS = [10, 20, 20, 30, 50] as const;

// 12 ODP contoh, satu per sel pada kisi 4 x 3 di sekitar pusat kota. Pelanggan
// memakai ODP terdekat dari titiknya, jadi tetangga berbagi ODP seperti di
// lapangan. Dihitung dari koordinat (bukan dari rng) supaya data lain tidak
// berubah.
const CENTER_LAT = -6.9175;
const CENTER_LNG = 107.6191;
const ODP_AREAS = [
  "CHP",
  "DGO",
  "BRG",
  "BBT",
  "KRC",
  "ATP",
  "STB",
  "SKJ",
  "PST",
  "CCD",
  "TMS",
  "LKG",
] as const;
const ODP_COLUMNS = 4;
const ODP_ROW_STEP = 0.0133;
const ODP_COLUMN_STEP = 0.01;

function nearestOdp(latitude: number, longitude: number) {
  const rows = ODP_AREAS.length / ODP_COLUMNS;
  let best = 0;
  let bestDistance = Infinity;
  ODP_AREAS.forEach((_, index) => {
    const row = Math.floor(index / ODP_COLUMNS);
    const column = index % ODP_COLUMNS;
    const dLat =
      latitude - (CENTER_LAT + (row - (rows - 1) / 2) * ODP_ROW_STEP);
    const dLng =
      longitude -
      (CENTER_LNG + (column - (ODP_COLUMNS - 1) / 2) * ODP_COLUMN_STEP);
    const distance = dLat * dLat + dLng * dLng;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return `ODP-${ODP_AREAS[best]}-${String(best + 1).padStart(2, "0")}`;
}

export const mockRouters: DashboardRouter[] = [
  { id: "router-1", name: "RTR-Pusat-01", host: "10.10.0.1", active: true },
  { id: "router-2", name: "RTR-Barat-02", host: "10.10.0.2", active: true },
  { id: "router-3", name: "RTR-Timur-03", host: "10.10.0.3", active: true },
];

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)];
}

export function createMockCustomers(): DashboardCustomer[] {
  return [];
}
