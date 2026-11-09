import "server-only";
import { env } from "@/lib/env";

type LatLng = [number, number];

// Profil foot: tanpa larangan satu arah dan ikut gang/footway, jadi garis tidak
// memutar blok seperti profil driving. Data OSRM harus diekstrak dengan foot.lua.
const PROFILE = "foot";
// Klien peta menyerah setelah 5 detik; jawab "belum menempel" sebelum itu.
const TIMEOUT_MS = 4000;

// Satu panggilan `route` dengan `radiuses`: OSRM menempelkan tiap titik ke jalan
// terdekat dan menolak (NoSegment) bila tak ada jalan dalam toleransi, lalu
// mengembalikan geometri jalan antar titik berurutan. Gagal apa pun = geometri asli.
export async function snapToRoads(points: LatLng[], toleranceM: number) {
  const manual = { snapped: false, geometry: points, provider: "manual" };
  // shortcut: koordinat polos di URL (~25 karakter/titik), cukup untuk rute ratusan titik; pakai polyline bila OSRM menolak URL panjang.
  const coords = points
    .map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`)
    .join(";");
  const radiuses = points.map(() => toleranceM).join(";");
  const url = `${env.OSRM_BASE_URL.replace(/\/+$/, "")}/route/v1/${PROFILE}/${coords}?overview=full&geometries=geojson&radiuses=${radiuses}`;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const body = await response.json();
    const line: unknown = body?.routes?.[0]?.geometry?.coordinates;
    if (
      !response.ok ||
      body.code !== "Ok" ||
      !Array.isArray(line) ||
      line.length < 2
    )
      return manual;
    return {
      snapped: true,
      geometry: (line as LatLng[]).map(([lng, lat]): LatLng => [lat, lng]),
      provider: `osrm-${PROFILE}`,
    };
  } catch (error) {
    console.error(
      "[snap] OSRM tidak bisa dihubungi:",
      error instanceof Error ? error.name : error,
    );
    return manual;
  }
}
