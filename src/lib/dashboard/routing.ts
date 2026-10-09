import { haversineDistanceMeters } from "./odp.ts";

export interface RoadRoute {
  coordinates: [number, number][];
  distanceMeters: number;
  isFallback: boolean;
}

const routeCache = new Map<string, RoadRoute>();

export function clearRouteCache(): void {
  routeCache.clear();
}

function cacheKey(from: [number, number], to: [number, number]): string {
  return `${from[0].toFixed(5)},${from[1].toFixed(5)}->${to[0].toFixed(5)},${to[1].toFixed(5)}`;
}

export async function fetchRoadRoute(
  from: [number, number],
  to: [number, number],
  options?: {
    fetchFn?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<RoadRoute> {
  const key = cacheKey(from, to);
  const cached = routeCache.get(key);
  if (cached) {
    return cached;
  }

  const straightDistance = haversineDistanceMeters(
    from[0],
    from[1],
    to[0],
    to[1],
  );
  const fallbackRoute: RoadRoute = {
    coordinates: [from, to],
    distanceMeters: straightDistance,
    isFallback: true,
  };

  const fetcher = options?.fetchFn ?? fetch;
  const timeoutMs = options?.timeoutMs ?? 3000;

  // Format OSRM: /route/v1/foot/{lon1},{lat1};{lon2},{lat2}?overview=full&geometries=geojson
  const url = `https://router.project-osrm.org/route/v1/foot/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetcher(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);

    if (!response.ok) {
      return fallbackRoute;
    }

    const data = await response.json();
    if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
      return fallbackRoute;
    }

    const best = data.routes[0];
    const geoCoordinates: [number, number][] = (
      best.geometry?.coordinates ?? []
    ).map(([lng, lat]: [number, number]) => [lat, lng]);

    if (geoCoordinates.length < 2) {
      return fallbackRoute;
    }

    const route: RoadRoute = {
      coordinates: geoCoordinates,
      distanceMeters: Math.round(best.distance ?? straightDistance),
      isFallback: false,
    };

    routeCache.set(key, route);
    return route;
  } catch {
    return fallbackRoute;
  }
}
