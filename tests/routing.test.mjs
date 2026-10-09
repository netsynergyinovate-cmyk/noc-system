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

test("fetchRoadRoute falls back on non-ok HTTP status or invalid body", async () => {
  const notOkFetch = async () => ({
    ok: false,
    status: 500,
    json: async () => ({}),
  });
  const from = [-6.9175, 107.6191];
  const to = [-6.9185, 107.6201];
  const route = await fetchRoadRoute(from, to, { fetchFn: notOkFetch });

  assert.equal(route.isFallback, true);
  assert.equal(route.coordinates.length, 2);
});
