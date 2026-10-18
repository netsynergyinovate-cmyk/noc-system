import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();

const {
  getLodLevelByZoom,
  filterCablesByZoomAndLod,
  getCablesByZoom,
} = await import("../src/services/cable-map.service.ts");
const { cableZoomQuerySchema } = await import(
  "../src/validators/cable-query.ts"
);
const routeCablesZoom = await import(
  "../src/app/api/map/cables/zoom/route.ts"
);
const routeCablesMain = await import(
  "../src/app/api/map/cables/route.ts"
);

test("Endpoint Jalur Kabel Per Zoom Peta (Cable Routes Per Zoom & LOD Endpoint)", async (t) => {
  await t.test("1. getLodLevelByZoom mengelompokkan level zoom ke tingkatan LOD yang tepat", () => {
    assert.equal(getLodLevelByZoom(8), "overview");
    assert.equal(getLodLevelByZoom(11), "overview");
    assert.equal(getLodLevelByZoom(12), "regional");
    assert.equal(getLodLevelByZoom(13), "regional");
    assert.equal(getLodLevelByZoom(14), "regional");
    assert.equal(getLodLevelByZoom(15), "detail");
    assert.equal(getLodLevelByZoom(18), "detail");
  });

  await t.test("2. filterCablesByZoomAndLod menyaring kabel sesuai hierarki serat optik dan LOD", () => {
    const mockCables = [
      {
        id: "c-backbone",
        type: "backbone",
        coreCapacity: 96,
        status: "active",
        coordinates: [
          [-6.2, 106.8],
          [-6.21, 106.81],
        ],
      },
      {
        id: "c-feeder-main",
        type: "feeder",
        coreCapacity: 24,
        status: "active",
        coordinates: [
          [-6.21, 106.81],
          [-6.22, 106.82],
        ],
      },
      {
        id: "c-distribution",
        type: "distribution",
        coreCapacity: 8,
        status: "active",
        coordinates: [
          [-6.22, 106.82],
          [-6.23, 106.83],
        ],
      },
      {
        id: "c-drop",
        type: "drop",
        coreCapacity: 2,
        status: "active",
        coordinates: [
          [-6.23, 106.83],
          [-6.235, 106.835],
        ],
      },
      {
        id: "c-drop-alert",
        type: "drop",
        coreCapacity: 2,
        status: "offline",
        coordinates: [
          [-6.235, 106.835],
          [-6.24, 106.84],
        ],
      },
    ];

    // LOD Overview (zoom <= 11): Backbone + Feeder kapasitas >= 24 + kabel offline
    const resOverview = filterCablesByZoomAndLod(mockCables, { zoom: 10 });
    assert.equal(resOverview.lodLevel, "overview");
    const overviewIds = resOverview.filtered.map((c) => c.id);
    assert.ok(overviewIds.includes("c-backbone"));
    assert.ok(overviewIds.includes("c-feeder-main"));
    assert.ok(overviewIds.includes("c-drop-alert")); // kabel offline tetap lolos
    assert.ok(!overviewIds.includes("c-drop")); // drop normal disaring

    // LOD Regional (zoom 13): Backbone + Feeder + Distribution + Drop Offline
    const resRegional = filterCablesByZoomAndLod(mockCables, { zoom: 13 });
    assert.equal(resRegional.lodLevel, "regional");
    const regionalIds = resRegional.filtered.map((c) => c.id);
    assert.ok(regionalIds.includes("c-backbone"));
    assert.ok(regionalIds.includes("c-feeder-main"));
    assert.ok(regionalIds.includes("c-distribution"));
    assert.ok(regionalIds.includes("c-drop-alert"));
    assert.ok(!regionalIds.includes("c-drop"));

    // LOD Regional dengan override includeDrop: true
    const resRegionalWithDrop = filterCablesByZoomAndLod(mockCables, {
      zoom: 13,
      includeDrop: true,
    });
    assert.ok(resRegionalWithDrop.filtered.some((c) => c.id === "c-drop"));

    // LOD Detail (zoom 16): Seluruh hierarki kabel disertakan
    const resDetail = filterCablesByZoomAndLod(mockCables, { zoom: 16 });
    assert.equal(resDetail.lodLevel, "detail");
    assert.equal(resDetail.filtered.length, 5);
  });

  await t.test("3. cableZoomQuerySchema memvalidasi parameter numerik dan string", () => {
    const valid = cableZoomQuerySchema.safeParse({
      zoom: "14",
      type: "feeder",
      minLat: "-6.3",
      maxLat: "-6.2",
      minLng: "106.8",
      maxLng: "106.9",
      includeDrop: "true",
    });

    assert.equal(valid.success, true);
    if (valid.success) {
      assert.equal(valid.data.zoom, 14);
      assert.equal(valid.data.type, "feeder");
      assert.equal(valid.data.includeDrop, true);
    }
  });

  await t.test("4. Route GET /api/map/cables/zoom menolak akses tanpa sesi dengan HTTP 401", async () => {
    const req = new Request("http://localhost:3000/api/map/cables/zoom?zoom=13");
    const res = await routeCablesZoom.GET(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, "UNAUTHORIZED");
  });

  await t.test("5. Route GET /api/map/cables?zoom=13 menolak akses tanpa sesi dengan HTTP 401", async () => {
    const req = new Request("http://localhost:3000/api/map/cables?zoom=13");
    const res = await routeCablesMain.GET(req);
    assert.equal(res.status, 401);
  });

  await t.test("6. Service getCablesByZoom mengekspor fungsi dan mengembalikan data dengan summary LOD", async () => {
    const result = await getCablesByZoom({
      zoom: 12,
      forceMock: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.zoom, 12);
    assert.equal(result.lodLevel, "regional");
    assert.ok(Array.isArray(result.cables));
    assert.ok(typeof result.summary.totalCables === "number");
    assert.ok(typeof result.summary.renderedCables === "number");
    assert.ok(typeof result.summary.filteredByZoom === "number");
  });
});
