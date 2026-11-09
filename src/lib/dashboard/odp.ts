import type { DashboardCustomer } from "./types";

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

export interface OdpPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  customerCount: number;
}

export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371e3; // metres
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(deltaLambda / 2) *
      Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

export function getOdpCoordinates(odpName: string): [number, number] | null {
  if (!odpName) return null;
  const match = odpName.match(/^ODP-([A-Z]{3})-\d{2}$/);
  if (!match) return null;
  const areaCode = match[1];
  const areaIndex = ODP_AREAS.indexOf(areaCode as (typeof ODP_AREAS)[number]);
  if (areaIndex === -1) return null;

  const rows = ODP_AREAS.length / ODP_COLUMNS;
  const row = Math.floor(areaIndex / ODP_COLUMNS);
  const column = areaIndex % ODP_COLUMNS;
  const lat = CENTER_LAT + (row - (rows - 1) / 2) * ODP_ROW_STEP;
  const lng = CENTER_LNG + (column - (ODP_COLUMNS - 1) / 2) * ODP_COLUMN_STEP;

  return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
}

export function getOdpList(
  customers: Array<
    Pick<DashboardCustomer, "odpName" | "latitude" | "longitude">
  >,
): OdpPoint[] {
  const odpMap = new Map<string, { count: number; coords: [number, number] }>();

  for (const c of customers) {
    if (!c.odpName) continue;
    const existing = odpMap.get(c.odpName);
    if (existing) {
      existing.count += 1;
    } else {
      const coords = getOdpCoordinates(c.odpName);
      if (coords) {
        odpMap.set(c.odpName, { count: 1, coords });
      }
    }
  }

  return Array.from(odpMap.entries()).map(([name, data]) => ({
    id: `odp-${name.toLowerCase()}`,
    name,
    latitude: data.coords[0],
    longitude: data.coords[1],
    customerCount: data.count,
  }));
}
