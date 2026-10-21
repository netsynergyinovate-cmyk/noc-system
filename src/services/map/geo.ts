export function haversineDistanceM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000; // Radius Bumi dalam meter
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

  return Math.round(R * c * 10) / 10;
}

export function calculatePolylineLengthM(points: [number, number][]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += haversineDistanceM(
      points[i][0],
      points[i][1],
      points[i + 1][0],
      points[i + 1][1],
    );
  }
  return Math.round(total * 10) / 10;
}

export interface GeneratedSample {
  sequence: number;
  latitude: number;
  longitude: number;
  cumulativeM: number;
}

export function generateSegmentSamples(
  points: [number, number][],
  intervalM: number = 50,
): { samples: GeneratedSample[]; totalLengthM: number } {
  if (points.length < 2) {
    return { samples: [], totalLengthM: 0 };
  }
  if (!(intervalM > 0)) {
    throw new Error("intervalM harus lebih dari 0.");
  }

  const samples: GeneratedSample[] = [];
  let seq = 1;
  let cumulative = 0;
  let nextAt = intervalM;

  // Titik pertama
  samples.push({
    sequence: seq++,
    latitude: points[0][0],
    longitude: points[0][1],
    cumulativeM: 0,
  });

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const segLen = haversineDistanceM(p1[0], p1[1], p2[0], p2[1]);
    if (segLen <= 0) continue;

    // Akumulator kontinu: nextAt tidak direset di tiap vertex.
    // Titik strictly di dalam ruas (tidak menimpa vertex akhir).
    const segEnd = cumulative + segLen;
    while (nextAt < segEnd) {
      const ratio = (nextAt - cumulative) / segLen;
      const lat = p1[0] + (p2[0] - p1[0]) * ratio;
      const lng = p1[1] + (p2[1] - p1[1]) * ratio;
      samples.push({
        sequence: seq++,
        latitude: Math.round(lat * 1e7) / 1e7,
        longitude: Math.round(lng * 1e7) / 1e7,
        cumulativeM: Math.round(nextAt * 10) / 10,
      });
      nextAt += intervalM;
    }

    cumulative = segEnd;
  }

  // Titik akhir jika belum sama
  const lastP = points[points.length - 1];
  samples.push({
    sequence: seq,
    latitude: lastP[0],
    longitude: lastP[1],
    cumulativeM: Math.round(cumulative * 10) / 10,
  });

  return {
    samples,
    totalLengthM: Math.round(cumulative * 10) / 10,
  };
}
