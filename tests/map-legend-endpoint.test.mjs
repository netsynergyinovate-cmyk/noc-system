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

const { getMapLegendMetadata } =
  await import("../src/services/map-legend.service.ts");
const routeMapLegend = await import("../src/app/api/map/legend/route.ts");
const routeMapConfig = await import("../src/app/api/map/config/route.ts");

test("Endpoint Metadata Legenda Peta (Map Legend Metadata Endpoint)", async (t) => {
  await t.test(
    "1. getMapLegendMetadata menghasilkan struktur data lengkap",
    () => {
      const metadata = getMapLegendMetadata();

      assert.ok(metadata.title);
      assert.equal(metadata.version, "1.0.0");
      assert.ok(metadata.nodes);
      assert.ok(metadata.cables);
      assert.ok(metadata.lod);
      assert.ok(metadata.gestures);
      assert.ok(metadata.dataSource.isRealData);
    },
  );

  await t.test(
    "2. Metadata titik pelanggan merinci status online, kritis, isolir, dan offline",
    () => {
      const { nodes } = getMapLegendMetadata();
      const customerIds = nodes.customers.map((c) => c.id);

      assert.ok(customerIds.includes("customer-online"));
      assert.ok(customerIds.includes("customer-warning"));
      assert.ok(customerIds.includes("customer-isolir"));
      assert.ok(customerIds.includes("customer-offline"));

      const online = nodes.customers.find((c) => c.id === "customer-online");
      assert.equal(online?.color, "#10b981");

      const warning = nodes.customers.find((c) => c.id === "customer-warning");
      assert.equal(warning?.threshold, "<= -24.5 dBm");
    },
  );

  await t.test(
    "3. Metadata infrastruktur merinci Core Router, OLT, ODC, ODP, dan Tiang",
    () => {
      const { nodes } = getMapLegendMetadata();
      const infraIds = nodes.infrastructure.map((i) => i.id);

      assert.ok(infraIds.includes("infra-core-router"));
      assert.ok(infraIds.includes("infra-olt"));
      assert.ok(infraIds.includes("infra-odc"));
      assert.ok(infraIds.includes("infra-odp"));
      assert.ok(infraIds.includes("infra-pole"));
    },
  );

  await t.test(
    "4. Metadata kabel optik mencakup 6 hierarki kapasitas dan ketebalan",
    () => {
      const { cables } = getMapLegendMetadata();
      assert.equal(cables.length, 6);

      const backbone = cables.find((c) => c.id === "cable-backbone");
      assert.ok(backbone);
      assert.equal(backbone?.baseWeight, 5.0);

      const feederMain = cables.find((c) => c.id === "cable-feeder-main");
      assert.ok(feederMain);
      assert.equal(feederMain?.baseWeight, 4.0);

      const feederDist = cables.find((c) => c.id === "cable-feeder-dist");
      assert.ok(feederDist);
      assert.equal(feederDist?.baseWeight, 3.2);

      const branch = cables.find((c) => c.id === "cable-branch");
      assert.ok(branch);
      assert.equal(branch?.baseWeight, 2.5);

      const drop = cables.find((c) => c.id === "cable-drop");
      assert.ok(drop);
      assert.equal(drop?.baseWeight, 1.8);

      const highlight = cables.find((c) => c.id === "cable-highlight");
      assert.ok(highlight);
      assert.equal(highlight?.isHighlighted, true);
    },
  );

  await t.test("5. Metadata LOD merinci 3 tingkatan zoom level", () => {
    const { lod } = getMapLegendMetadata();
    assert.equal(lod.length, 3);
    const levels = lod.map((l) => l.level);
    assert.ok(levels.includes("overview"));
    assert.ok(levels.includes("regional"));
    assert.ok(levels.includes("detail"));
  });

  await t.test(
    "6. Route GET /api/map/legend menolak request tanpa sesi dengan HTTP 401",
    async () => {
      const req = new Request("http://localhost:3000/api/map/legend");
      const res = await routeMapLegend.GET(req);
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error.code, "UNAUTHORIZED");
    },
  );

  await t.test(
    "7. Route GET /api/map/config?includeLegend=true menolak request tanpa sesi dengan HTTP 401",
    async () => {
      const req = new Request(
        "http://localhost:3000/api/map/config?includeLegend=true",
      );
      const res = await routeMapConfig.GET(req);
      assert.equal(res.status, 401);
    },
  );
});
