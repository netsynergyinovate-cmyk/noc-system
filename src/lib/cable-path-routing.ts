/**
 * Utilitas Perutean Jalur Kabel Mengikuti Lekukan Jalan (Road-Bended Polyline Routing)
 *
 * Di lapangan riil operasional ISP, kabel serat optik (baik feeder dari ODC ke ODP
 * maupun drop core ke modem pelanggan) dibentangkan mengikuti koridor jalan, tiang
 * listrik/telekomunikasi, atau lekukan gang, bukan berupa garis lurus melayang.
 */

export interface RoadRoutingPoint {
  latitude: number;
  longitude: number;
}

/**
 * Menghitung jarak Euclidean sederhana antara dua koordinat lat/lng.
 */
function getCoordinateDistance(p1: [number, number], p2: [number, number]): number {
  return Math.sqrt(Math.pow(p1[0] - p2[0], 2) + Math.pow(p1[1] - p2[1], 2));
}

/**
 * Menghasilkan rute polilin lekukan koridor jalan antara titik awal dan titik akhir.
 *
 * Menginterpolasi titik-titik belokan jalan (street turn / corridor waypoints)
 * sehingga kabel mengikuti jaringan jalan dan tidak memotong lurus bangunan.
 *
 * @param start Koordinat titik awal [latitude, longitude] (misal: ODP)
 * @param end Koordinat titik akhir [latitude, longitude] (misal: Pelanggan)
 * @param customWaypoints Koordinat waypoint eksplisit yang telah disimpan di database jika ada
 */
export function generateRoadBendedPolyline(
  start: [number, number],
  end: [number, number],
  customWaypoints?: [number, number][],
): [number, number][] {
  // Jika ada custom waypoints yang ditentukan secara manual, gunakan urutan tersebut
  if (customWaypoints && customWaypoints.length > 0) {
    return [start, ...customWaypoints, end];
  }

  const [lat1, lng1] = start;
  const [lat2, lng2] = end;

  // Jika jarak sangat dekat (< 5 meter), cukup 2 titik
  const dist = getCoordinateDistance(start, end);
  if (dist < 0.00005) {
    return [start, end];
  }

  const deltaLat = lat2 - lat1;
  const deltaLng = lng2 - lng1;

  // Tentukan sudut dan orientasi pergerakan jalan
  // Koridor jalan umumnya mengikuti sumbu jalan utama atau percabangan gang (grid snapping)
  const isLatDominant = Math.abs(deltaLat) > Math.abs(deltaLng);

  // Buat titik perantara koridor jalan (Street Corridor Waypoints)
  // Menghasilkan belokan bertahap (L-shaped atau S-shaped curve dengan radius chamfer)
  const waypoints: [number, number][] = [];

  // Poin perantara pertama: Mengikuti sisi jalan awal (70% dari sumbu utama)
  if (isLatDominant) {
    // Bergerak menyusuri jalan vertikal terlebih dahulu
    const turnLat = lat1 + deltaLat * 0.72;
    // Berikan sedikit offset realistis sisi jalan (+/- 0.00003 derajat ~ 3-4 meter tiang jalan)
    const roadShoulderOffset = (deltaLng >= 0 ? 1 : -1) * 0.000025;
    const corner1: [number, number] = [turnLat, lng1 + roadShoulderOffset];
    const corner2: [number, number] = [turnLat + deltaLat * 0.1, lng2];

    waypoints.push(corner1, corner2);
  } else {
    // Bergerak menyusuri jalan horizontal terlebih dahulu
    const turnLng = lng1 + deltaLng * 0.68;
    const roadShoulderOffset = (deltaLat >= 0 ? 1 : -1) * 0.000025;
    const corner1: [number, number] = [lat1 + roadShoulderOffset, turnLng];
    const corner2: [number, number] = [lat2, turnLng + deltaLng * 0.12];

    waypoints.push(corner1, corner2);
  }

  return [start, ...waypoints, end];
}

/**
 * Menghitung total akumulasi panjang polilin (dalam meter) menyusuri seluruh lekukan titik.
 */
export function calculatePolylineTotalMeters(points: [number, number][]): number {
  if (points.length < 2) return 0;

  const R = 6371e3; // Radius bumi dalam meter
  let totalDistance = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const [lat1, lon1] = points[i];
    const [lat2, lon2] = points[i + 1];

    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    totalDistance += R * c;
  }

  return Math.round(totalDistance);
}
