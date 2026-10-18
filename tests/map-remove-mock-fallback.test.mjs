import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Task: Hapus fallback data contoh di endpoint peta (Backend Phase 4)", async (t) => {
  const routesToCheck = [
    {
      name: "Network Unified Map",
      file: "src/app/api/map/network/route.ts",
    },
    {
      name: "Unified Map Endpoint",
      file: "src/app/api/map/unified/route.ts",
    },
    {
      name: "Infrastructure Placement",
      file: "src/app/api/map/infrastructure/route.ts",
    },
    {
      name: "Map Layers",
      file: "src/app/api/map/layers/route.ts",
    },
    {
      name: "Map Markers",
      file: "src/app/api/map/markers/route.ts",
    },
    {
      name: "Topology Hierarchy",
      file: "src/app/api/map/hierarchy/route.ts",
    },
    {
      name: "Customer Locations",
      file: "src/app/api/map/customers/route.ts",
    },
  ];

  await t.test("1. Endpoint Peta Tidak Memiliki Cabang Fallback mode=mock atau forceMock", () => {
    for (const r of routesToCheck) {
      const fullPath = path.join(process.cwd(), r.file);
      assert.ok(fs.existsSync(fullPath), `Berkas ${r.file} wajib tersedia`);
      const content = fs.readFileSync(fullPath, "utf-8");

      assert.doesNotMatch(
        content,
        /searchParams\.get\(["']mode["']\)\s*===?\s*["']mock["']/,
        `Endpoint ${r.name} (${r.file}) dilarang memeriksa mode=mock`,
      );
      assert.doesNotMatch(
        content,
        /searchParams\.get\(["']forceMock["']\)/,
        `Endpoint ${r.name} (${r.file}) dilarang mengekspos query parameter forceMock`,
      );
      assert.doesNotMatch(
        content,
        /process\.env\.DASHBOARD_DATA\s*===?\s*["']demo["']/,
        `Endpoint ${r.name} (${r.file}) dilarang fallback diam-diam saat DASHBOARD_DATA demo`,
      );
    }
  });

  await t.test("2. Endpoint /api/map/network dan /api/map/unified Memanggil getCompleteRealMapData Nyata", () => {
    const networkContent = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/map/network/route.ts"),
      "utf-8",
    );
    const unifiedContent = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/map/unified/route.ts"),
      "utf-8",
    );

    assert.match(
      networkContent,
      /getCompleteRealMapData/,
      "Endpoint /api/map/network wajib mengambil data dari getCompleteRealMapData",
    );
    assert.match(
      unifiedContent,
      /getCompleteRealMapData/,
      "Endpoint /api/map/unified wajib mengambil data dari getCompleteRealMapData",
    );
    assert.doesNotMatch(
      networkContent,
      /getNetworkMapData\(\{\s*forceMock:\s*true\s*\}\)/,
      "Endpoint /api/map/network dilarang fallback ke getNetworkMapData({ forceMock: true })",
    );
    assert.doesNotMatch(
      unifiedContent,
      /getNetworkMapData\(\{\s*forceMock:\s*true\s*\}\)/,
      "Endpoint /api/map/unified dilarang fallback ke getNetworkMapData({ forceMock: true })",
    );
  });

  await t.test("3. Service Peta Tidak Menyembunyikan Database Error Diam-diam (Zero-Dummy & Kejujuran Telemetri)", () => {
    const networkMapService = fs.readFileSync(
      path.join(process.cwd(), "src/services/network-map.service.ts"),
      "utf-8",
    );
    const customerLocationService = fs.readFileSync(
      path.join(process.cwd(), "src/services/customer-location.service.ts"),
      "utf-8",
    );

    // Di blok catch, tidak boleh return getLocalMockMapData()
    assert.doesNotMatch(
      networkMapService,
      /catch\s*\([a-zA-Z0-9_]+\)\s*\{[\s\S]*?return getLocalMockMapData\(\)/,
      "network-map.service dilarang mengembalikan data mock saat PostgreSQL catch error",
    );
    assert.doesNotMatch(
      customerLocationService,
      /catch\s*\([a-zA-Z0-9_]+\)\s*\{[\s\S]*?Fallback Local Database \(Offline\)/,
      "customer-location.service dilarang mengembalikan fallback offline dummy saat catch error",
    );
  });

  await t.test("4. Service map-infrastructure & network-hierarchy Bebas dari Fallback Mock Otomatis", () => {
    const infraService = fs.readFileSync(
      path.join(process.cwd(), "src/services/map-infrastructure.service.ts"),
      "utf-8",
    );
    const hierarchyService = fs.readFileSync(
      path.join(process.cwd(), "src/services/network-hierarchy.service.ts"),
      "utf-8",
    );

    assert.doesNotMatch(
      infraService,
      /if\s*\(\s*dbRows\.length\s*===?\s*0\s*\)\s*\{[\s\S]*?getLocalMockMapData/,
      "getInfrastructureList dilarang fallback ke mock jika dbRows kosong",
    );
    assert.doesNotMatch(
      hierarchyService,
      /if\s*\(\s*rawInfra\.length\s*===?\s*0[\s\S]*?\)\s*\{[\s\S]*?getLocalMockMapData/,
      "getNetworkHierarchyData dilarang fallback ke mock jika rawInfra kosong",
    );
  });
});
