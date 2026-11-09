import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const registryPath = path.resolve(
  __dirname,
  "../src/lib/map-data-source-registry.ts",
);
const servicePath = path.resolve(
  __dirname,
  "../src/services/real-map-data.service.ts",
);
const networkRoutePath = path.resolve(
  __dirname,
  "../src/app/api/map/network/route.ts",
);
const dataSourceRoutePath = path.resolve(
  __dirname,
  "../src/app/api/map/data-source/route.ts",
);

test("Task: Siapkan Skema Database dan Endpoint Data Peta Nyata", async (t) => {
  const registryContent = fs.readFileSync(registryPath, "utf8");
  const serviceContent = fs.readFileSync(servicePath, "utf8");
  const networkRouteContent = fs.readFileSync(networkRoutePath, "utf8");
  const dataSourceRouteContent = fs.readFileSync(dataSourceRoutePath, "utf8");

  await t.test(
    "1. Modul Registri Sumber Data Peta Nyata (map-data-source-registry.ts)",
    async () => {
      const {
        MAP_DATA_SOURCE_REGISTRY,
        getMapDataSourceById,
        getMapDataSourcesSummary,
      } = await import("../src/lib/map-data-source-registry.ts");

      assert.equal(
        MAP_DATA_SOURCE_REGISTRY.length,
        4,
        "Wajib mendaftarkan 4 modul sumber data peta utama",
      );

      for (const item of MAP_DATA_SOURCE_REGISTRY) {
        assert.equal(
          item.isLiveOperational,
          true,
          "Semua sumber data peta harus bertatus live operational",
        );
        assert.equal(
          item.sourceType,
          "postgresql",
          "Tipe sumber data utama harus PostgreSQL",
        );
        assert.match(
          item.endpointPath,
          /^\/api\//,
          "Endpoint path harus mengarah ke rute /api valid",
        );
        assert.ok(
          item.coordinateFields.length > 0,
          "Setiap modul harus memiliki field koordinat terdaftar",
        );
      }

      const customerSource = getMapDataSourceById("customers-geocoded");
      assert.ok(
        customerSource,
        "Harus menemukan sumber data customers-geocoded",
      );
      assert.equal(customerSource?.tableName, "customers");

      const infraSource = getMapDataSourceById("network-infrastructure");
      assert.ok(
        infraSource,
        "Harus menemukan sumber data network-infrastructure",
      );
      assert.equal(infraSource?.tableName, "network_infrastructure");

      const summary = getMapDataSourcesSummary();
      assert.equal(summary.totalSources, 4);
      assert.equal(summary.liveOperationalSources, 4);
      assert.deepEqual(summary.registeredTables, [
        "customers",
        "network_infrastructure",
        "network_cables",
        "network_device_relations",
      ]);
    },
  );

  await t.test("2. Service Data Peta Nyata (real-map-data.service.ts)", () => {
    assert.match(
      serviceContent,
      /export async function getCompleteRealMapData/,
      "Wajib mengekspor fungsi getCompleteRealMapData",
    );
    assert.match(
      serviceContent,
      /export async function checkMapDatabaseHealth/,
      "Wajib mengekspor fungsi checkMapDatabaseHealth",
    );
    assert.match(
      serviceContent,
      /\.from\(customers\)/,
      "Wajib membaca tabel customers",
    );
    assert.match(
      serviceContent,
      /\.from\(networkInfrastructure\)/,
      "Wajib membaca tabel networkInfrastructure",
    );
    assert.match(
      serviceContent,
      /\.from\(networkCables\)/,
      "Wajib membaca tabel networkCables",
    );
    assert.match(
      serviceContent,
      /isRealData:\s*true/,
      "Wajib menandai isRealData true",
    );
    assert.match(
      serviceContent,
      /registry:\s*MAP_DATA_SOURCE_REGISTRY/,
      "Wajib menyertakan MAP_DATA_SOURCE_REGISTRY di metadata dataSource",
    );
    assert.doesNotMatch(
      serviceContent,
      /dummy_node|dummy_customer|fake_point/i,
      "Dilarang menyematkan data dummy palsu di service data nyata",
    );
  });

  await t.test("3. Endpoint API Terpadu Peta Nyata (/api/map/network)", () => {
    assert.match(
      networkRouteContent,
      /export function GET\(request:\s*Request\)/,
      "Wajib menyediakan handler GET",
    );
    assert.match(
      networkRouteContent,
      /withApiSession\(request/,
      "Endpoint wajib diproteksi dengan withApiSession",
    );
    assert.match(
      networkRouteContent,
      /getCompleteRealMapData/,
      "Endpoint wajib memanggil getCompleteRealMapData untuk data nyata",
    );
    assert.match(
      networkRouteContent,
      /includeCables/,
      "Endpoint wajib mendukung opsi includeCables",
    );
  });

  await t.test(
    "4. Endpoint API Registri & Kesehatan Data Sumber Peta (/api/map/data-source)",
    () => {
      assert.match(
        dataSourceRouteContent,
        /export function GET\(request:\s*Request\)/,
        "Wajib menyediakan handler GET",
      );
      assert.match(
        dataSourceRouteContent,
        /withApiSession\(request/,
        "Endpoint wajib diproteksi dengan withApiSession",
      );
      assert.match(
        dataSourceRouteContent,
        /checkMapDatabaseHealth\(\)/,
        "Endpoint wajib memeriksa kesehatan database via checkMapDatabaseHealth",
      );
      assert.match(
        dataSourceRouteContent,
        /MAP_DATA_SOURCE_REGISTRY/,
        "Endpoint wajib menyertakan MAP_DATA_SOURCE_REGISTRY",
      );
    },
  );
});
