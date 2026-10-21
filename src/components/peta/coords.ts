// Desimal dengan pemisah titik saja; parseFloat("12abc") = 12 dan Number("") = 0 lolos, jadi pakai regex.
const DECIMAL = /^-?\d+(\.\d+)?$/;

export const COORD_ERROR =
  "Koordinat tidak valid. Isi angka desimal (pemisah titik): latitude -90..90, longitude -180..180.";

export function parseCoordinates(
  lat: string,
  lng: string,
): { lat: number; lng: number } | null {
  const a = lat.trim();
  const b = lng.trim();
  if (!DECIMAL.test(a) || !DECIMAL.test(b)) return null;
  const parsed = { lat: Number(a), lng: Number(b) };
  if (Math.abs(parsed.lat) > 90 || Math.abs(parsed.lng) > 180) return null;
  return parsed;
}
