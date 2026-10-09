# Satellite Map, GPS Geolocation, & ODP Road Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `CustomerMap` with professional Google Hybrid satellite tiles, GPS geolocation for field technicians, ODP distribution point markers, and automatic road-following fiber cable routing (via OSRM) for focused PPPoE customers.

**Architecture:** Split domain logic cleanly: `src/lib/dashboard/odp.ts` computes and manages ODP coordinates; `src/lib/dashboard/routing.ts` queries OSRM pedestrian routing with client-side caching and straight-line fallback; and `src/components/dashboard/customer-map.tsx` integrates the satellite tile layer switcher, GPS geolocation button, ODP markers, and on-demand cable polyline while preserving existing Playwright testing contracts.

**Tech Stack:** Next.js 16 (App Router), React 19, Leaflet 1.9.4, react-leaflet 5.0.0, OSRM Public Routing API, Tailwind CSS v4, Node.js built-in test runner (`node --test`), Playwright.

## Global Constraints

- No paid Google Maps API keys required: use Google Hybrid tiles (`https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}`) with fallback to OpenStreetMap.
- Preserve all existing Playwright test selectors and attributes: `data-testid="customer-map"`, `data-zoom`, `data-testid="map-focus-banner"`, `.leaflet-tooltip-top`, `data-testid="customer-odp"`, and `data-testid="billing-badge"`.
- Cable routing is on-demand (only drawn when a customer is focused) to keep map rendering fast and clean.
- Resilient network handling: fallback to straight line polyline if OSRM is unreachable or times out (>3 seconds).
- Do not break existing TypeScript typechecks (`npm run typecheck`).

---

### Task 1: ODP Domain & Coordinate Helpers

**Files:**
- Create: `src/lib/dashboard/odp.ts`
- Test: `tests/odp.test.mjs`

**Interfaces:**
- Produces:
  - `interface OdpPoint { id: string; name: string; latitude: number; longitude: number; customerCount: number; }`
  - `getOdpCoordinates(odpName: string): [number, number] | null`
  - `getOdpList(customers: DashboardCustomer[]): OdpPoint[]`
  - `haversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number`

- [ ] **Step 1: Write the failing unit test**

Create `tests/odp.test.mjs`:
```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  getOdpCoordinates,
  getOdpList,
  haversineDistanceMeters,
} from "../src/lib/dashboard/odp.ts";

test("getOdpCoordinates returns coordinates for known ODP areas", () => {
  const coords = getOdpCoordinates("ODP-CHP-01");
  assert.ok(coords !== null, "ODP coordinates should exist");
  assert.equal(typeof coords[0], "number");
  assert.equal(typeof coords[1], "number");
  assert.ok(coords[0] < 0, "Latitude should be negative in Indonesia");
  assert.ok(coords[1] > 100, "Longitude should be positive in Indonesia");
});

test("getOdpCoordinates returns null for invalid ODP name", () => {
  assert.equal(getOdpCoordinates("INVALID-ODP"), null);
  assert.equal(getOdpCoordinates(""), null);
});

test("getOdpList groups customers and counts connections", () => {
  const mockCustomers = [
    { id: "c1", odpName: "ODP-CHP-01", latitude: -6.91, longitude: 107.61 },
    { id: "c2", odpName: "ODP-CHP-01", latitude: -6.911, longitude: 107.611 },
    { id: "c3", odpName: "ODP-DGO-02", latitude: -6.92, longitude: 107.62 },
  ];
  const odps = getOdpList(mockCustomers);
  assert.equal(odps.length, 2);
  const chp = odps.find((o) => o.name === "ODP-CHP-01");
  assert.ok(chp);
  assert.equal(chp.customerCount, 2);
});

test("haversineDistanceMeters calculates reasonable distances", () => {
  const dist = haversineDistanceMeters(-6.9175, 107.6191, -6.9185, 107.6191);
  assert.ok(dist > 100 && dist < 125, `Expected ~111m, got ${dist}m`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/odp.test.mjs`
Expected: FAIL (module `../src/lib/dashboard/odp.ts` not found)

- [ ] **Step 3: Implement `src/lib/dashboard/odp.ts`**

Create `src/lib/dashboard/odp.ts`:
```typescript
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
  customers: Array<Pick<DashboardCustomer, "odpName" | "latitude" | "longitude">>,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/odp.test.mjs`
Expected: PASS (all 4 tests pass)

- [ ] **Step 5: Commit Task 1**

```bash
git add src/lib/dashboard/odp.ts tests/odp.test.mjs
git commit -m "feat(map): add odp domain coordinates and clustering helpers"
```

---

### Task 2: Road Routing Service via OSRM

**Files:**
- Create: `src/lib/dashboard/routing.ts`
- Test: `tests/routing.test.mjs`

**Interfaces:**
- Produces:
  - `interface RoadRoute { coordinates: [number, number][]; distanceMeters: number; isFallback: boolean; }`
  - `fetchRoadRoute(from: [number, number], to: [number, number], options?: { fetchFn?: typeof fetch; timeoutMs?: number }): Promise<RoadRoute>`
  - `clearRouteCache(): void`

- [ ] **Step 1: Write the failing unit test**

Create `tests/routing.test.mjs`:
```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchRoadRoute,
  clearRouteCache,
} from "../src/lib/dashboard/routing.ts";

test.beforeEach(() => {
  clearRouteCache();
});

test("fetchRoadRoute falls back to straight line when fetch fails or times out", async () => {
  const failingFetch = async () => {
    throw new Error("Network error");
  };
  const from = [-6.9175, 107.6191];
  const to = [-6.9185, 107.6201];
  const route = await fetchRoadRoute(from, to, { fetchFn: failingFetch });

  assert.equal(route.isFallback, true);
  assert.equal(route.coordinates.length, 2);
  assert.deepEqual(route.coordinates[0], from);
  assert.deepEqual(route.coordinates[1], to);
  assert.ok(route.distanceMeters > 0);
});

test("fetchRoadRoute parses OSRM GeoJSON response and caches it", async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount += 1;
    return {
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [
          {
            distance: 250.5,
            geometry: {
              coordinates: [
                [107.6191, -6.9175],
                [107.6195, -6.918],
                [107.6201, -6.9185],
              ],
            },
          },
        ],
      }),
    };
  };

  const from = [-6.9175, 107.6191];
  const to = [-6.9185, 107.6201];
  const route1 = await fetchRoadRoute(from, to, { fetchFn: mockFetch });

  assert.equal(route1.isFallback, false);
  assert.equal(route1.distanceMeters, 251);
  assert.equal(route1.coordinates.length, 3);
  // OSRM coordinates are [lng, lat], our result is [lat, lng] for Leaflet
  assert.deepEqual(route1.coordinates[0], [-6.9175, 107.6191]);

  // Second call with same coordinates should hit cache without calling fetch
  const route2 = await fetchRoadRoute(from, to, { fetchFn: mockFetch });
  assert.equal(callCount, 1, "Should reuse cached result");
  assert.deepEqual(route2, route1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/routing.test.mjs`
Expected: FAIL (module `../src/lib/dashboard/routing.ts` not found)

- [ ] **Step 3: Implement `src/lib/dashboard/routing.ts`**

Create `src/lib/dashboard/routing.ts`:
```typescript
import { haversineDistanceMeters } from "./odp";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/routing.test.mjs`
Expected: PASS (all routing tests pass)

- [ ] **Step 5: Commit Task 2**

```bash
git add src/lib/dashboard/routing.ts tests/routing.test.mjs
git commit -m "feat(map): implement osrm road routing client with caching and fallback"
```

---

### Task 3: Upgrade `CustomerMap` with Satellite, Switcher, GPS, ODP Markers & Road Polyline

**Files:**
- Modify: `src/components/dashboard/customer-map.tsx`

**Requirements:**
- Add state for layer mode: `"satellite"` (default) vs `"streets"` (OSM).
  - Satellite URL: `https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}` with maxNativeZoom=20, maxZoom=20.
  - Streets URL: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`.
- Add Layer Switcher UI button on map overlay (top-left or bottom-right control).
- Add GPS "Lokasi Saya" button:
  - Uses `navigator.geolocation` or `map.locate()`.
  - When located, animates `map.flyTo([lat, lng], 17)` and renders a pulsing user location marker + accuracy circle.
  - Displays user status or error if permission denied.
- Render ODP markers:
  - Compute ODPs from customers using `getOdpList(customers)`.
  - Render as cyan square/circle marker with fiber distribution icon/style and tooltip showing ODP name and subscriber count.
- Click customer marker:
  - Clicking a customer marker calls `useDashboardStore.getState().focusMap(customer.id)` to focus them.
- Render Road Polyline:
  - When customer is focused (`focused` is non-null):
    - Find their ODP coordinate from `getOdpCoordinates(focused.odpName)`.
    - Call `fetchRoadRoute` to retrieve the road polyline.
    - Render `<Polyline>` with high-contrast glowing optic style (`color: "#06b6d4"`, `weight: 4`).
    - Banner displays cable length e.g. `(Kabel: 135 m ke ODP-CHP-01)`.
- Maintain complete compatibility with existing e2e selectors:
  - `data-testid="customer-map"`
  - `data-zoom`
  - `data-testid="map-focus-banner"`
  - `leaflet-tooltip-top`
  - `data-testid="customer-odp"`
  - `data-testid="billing-badge"`

- [ ] **Step 1: Update `src/components/dashboard/customer-map.tsx`**

Integrate the layer switcher, GPS geolocation, ODP markers, and OSRM cable polyline.

- [ ] **Step 2: Run typecheck to verify no typing errors**

Run: `npm run typecheck`
Expected: PASS (no TypeScript errors)

- [ ] **Step 3: Run existing unit and database tests**

Run: `node --test tests/odp.test.mjs tests/routing.test.mjs`
Expected: PASS

- [ ] **Step 4: Commit Task 3**

```bash
git add src/components/dashboard/customer-map.tsx
git commit -m "feat(map): upgrade customer map with satellite tiles, gps, odp markers, and road routing"
```

---

### Task 4: Add Map Upgrade Integration Tests & Verification

**Files:**
- Create: `e2e/customer-map-upgrade.spec.ts`

**Tests:**
- Verify map renders Google Hybrid Satellite tile layer by default.
- Verify layer switcher button switches between Satelit and Jalan.
- Verify ODP markers are rendered on the map.
- Verify clicking a customer marker focuses the customer and draws the road-following cable polyline.
- Verify banner displays cable distance to ODP.
- Verify GPS button is rendered with accessible label.

- [x] **Step 1: Write `e2e/customer-map-upgrade.spec.ts`**
- [x] **Step 2: Run existing map e2e tests & verify they continue passing**

Run:
```bash
npm run typecheck
```

- [x] **Step 3: Commit Task 4**

```bash
git add e2e/customer-map-upgrade.spec.ts
git commit -m "test(map): add e2e test suite for satellite view, odp markers, and cable routing"
```
