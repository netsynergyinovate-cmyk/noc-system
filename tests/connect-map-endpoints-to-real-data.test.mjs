import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Task: Sambungkan Endpoint Peta ke Data Nyata (Backend)", async (t) => {
  const routesToCheck = [
    {
      name: "Network Unified Map",
      file: "src/app/api/map/network/route.ts",
      serviceRef: "getCompleteRealMapData",
    },
    {
      name: "Unified Map Endpoint",
      file: "src/app/api/map/unified/route.ts",
      serviceRef: "getCompleteRealMapData",
    },
    {
      name: "Customer Location Points",
      file: "src/app/api/map/customers/route.ts",
      serviceRef: "getGeocodedCustomers",
    },
    {
      name: "Infrastructure Placement Points",
      file: "src/app/api/map/infrastructure/route.ts",
      serviceRef: "getInfrastructureList",
    },
    {
      name: "Fiber Cables Segments",
      file: "src/app/api/map/cables/route.ts",
      serviceRef: "getCableMapData",
    },
    {
      name: "Topology Hierarchy",
      file: "src/app/api/map/hierarchy/route.ts",
      serviceRef: "getNetworkHierarchyData",
    },
    {
      name: "Data Source Health Registry",
      file: "src/app/api/map/data-source/route.ts",
      serviceRef: "checkMapDatabaseHealth",
    },
    {
      name: "Map Layers",
      file: "src/app/api/map/layers/route.ts",
      serviceRef: "getMapLayersData",
    },
    {
      name: "Map Markers",
      file: "src/app/api/map/markers/route.ts",
      serviceRef: "getMapMarkersData",
    },
  ];

  await t.test("1. Seluruh 9 Endpoint Peta Menggunakan withApiSession & Runtime Nodejs", () => {
    for (const r of routesToCheck) {
      const fullPath = path.join(process.cwd(), r.file);
      assert.ok(fs.existsSync(fullPath), `Berkas ${r.file} wajib tersedia`);
      const content = fs.readFileSync(fullPath, "utf-8");

      assert.match(
        content,
        /withApiSession\(request/,
        `Endpoint ${r.name} (${r.file}) wajib diproteksi sesi autentikasi withApiSession`,
      );
      assert.match(
        content,
        /export const runtime\s*=\s*"nodejs"/,
        `Endpoint ${r.name} (${r.file}) wajib menggunakan runtime nodejs`,
      );
      assert.match(
        content,
        new RegExp(r.serviceRef),
        `Endpoint ${r.name} wajib memanggil service ${r.serviceRef}`,
      );
    }
  });

  await t.test("2. Sambungan Service Peta ke Tabel PostgreSQL Operasional Riil", () => {
    const realMapService = fs.readFileSync(
      path.join(process.cwd(), "src/services/real-map-data.service.ts"),
      "utf-8",
    );
    const layersService = fs.readFileSync(
      path.join(process.cwd(), "src/services/map-layers.service.ts"),
      "utf-8",
    );
    const cablesService = fs.readFileSync(
      path.join(process.cwd(), "src/services/cable-map.service.ts"),
      "utf-8",
    );

    // real-map-data.service.ts
    assert.match(
      realMapService,
      /db\.select\(\)[\s\S]*?\.from\(networkInfrastructure\)/,
      "real-map-data.service wajib membaca tabel fisik network_infrastructure",
    );
    assert.match(
      realMapService,
      /\.from\(customers\)/,
      "real-map-data.service wajib membaca tabel fisik customers",
    );
    assert.match(
      realMapService,
      /\.from\(networkCables\)/,
      "real-map-data.service wajib membaca tabel fisik network_cables",
    );

    // map-layers.service.ts
    assert.match(
      layersService,
      /db\.select\(\)\.from\(networkCables\)/,
      "map-layers.service wajib membaca jalur bentangan riil dari networkCables",
    );

    // cable-map.service.ts
    assert.match(
      cablesService,
      /networkInfrastructure/,
      "cable-map.service wajib membaca dan menyimpan konfigurasi kabel ke networkInfrastructure",
    );
  });

  await t.test("3. Verifikasi Transparansi Zero-Dummy pada Respon Sumber Data", () => {
    const realMapService = fs.readFileSync(
      path.join(process.cwd(), "src/services/real-map-data.service.ts"),
      "utf-8",
    );
    assert.match(
      realMapService,
      /isRealData:\s*true/,
      "Service wajib mencantumkan isRealData: true saat membaca PostgreSQL",
    );
    assert.match(
      realMapService,
      /provider:\s*"PostgreSQL Database \(NOC Operational\)"/,
      "Service wajib mengidentifikasi provider PostgreSQL Database (NOC Operational)",
    );
    assert.doesNotMatch(
      realMapService,
      /dummy_node|dummy_customer|fake_point/i,
      "Dilarang menghasilkan data dummy palsu",
    );
  });
});
