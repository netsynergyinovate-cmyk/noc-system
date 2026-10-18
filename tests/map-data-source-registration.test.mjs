import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DATA_SOURCE_REGISTRY,
  MAP_DATA_SOURCE_REGISTRY,
  getRegisteredMapDataSources,
  isDataSourceRegistered,
  getDataSourceByTableName,
  getMapDataSourcesSummary,
} from "../src/lib/data-source-registry.ts";

test("Task: Daftarkan Sumber Peta di data_source_registry", async (t) => {
  const dataSourceRoutePath = path.join(
    process.cwd(),
    "src/app/api/map/data-source/route.ts",
  );
  const registryModulePath = path.join(
    process.cwd(),
    "src/lib/data-source-registry.ts",
  );
  const aliasModulePath = path.join(
    process.cwd(),
    "src/lib/data_source_registry.ts",
  );

  const dataSourceRouteContent = fs.readFileSync(dataSourceRoutePath, "utf-8");
  const registryModuleContent = fs.readFileSync(registryModulePath, "utf-8");

  await t.test("1. Ketersediaan Modul data-source-registry & data_source_registry", () => {
    assert.ok(fs.existsSync(registryModulePath), "src/lib/data-source-registry.ts wajib ada");
    assert.ok(fs.existsSync(aliasModulePath), "src/lib/data_source_registry.ts wajib ada sebagai alias");
    assert.ok(DATA_SOURCE_REGISTRY, "DATA_SOURCE_REGISTRY wajib diekspor");
    assert.ok(MAP_DATA_SOURCE_REGISTRY, "MAP_DATA_SOURCE_REGISTRY wajib diekspor");
  });

  await t.test("2. Verifikasi 4 Sumber Data Fisik Peta Terdaftar Lengkap", () => {
    const sources = getRegisteredMapDataSources();
    assert.equal(sources.length, 4, "Wajib mendaftarkan 4 sumber data fisik peta utama");

    const expectedEntries = [
      {
        id: "customers-geocoded",
        tableName: "customers",
        endpoint: "/api/map/customers",
      },
      {
        id: "network-infrastructure",
        tableName: "network_infrastructure",
        endpoint: "/api/map/infrastructure",
      },
      {
        id: "network-cables",
        tableName: "network_cables",
        endpoint: "/api/map/cables",
      },
      {
        id: "network-device-relations",
        tableName: "network_device_relations",
        endpoint: "/api/devices/relations",
      },
    ];

    for (const exp of expectedEntries) {
      const found = sources.find((s) => s.id === exp.id);
      assert.ok(found, `Sumber data '${exp.id}' wajib terdaftar`);
      assert.equal(found.tableName, exp.tableName, `Tabel database untuk '${exp.id}' harus '${exp.tableName}'`);
      assert.equal(found.endpointPath, exp.endpoint, `Endpoint rute untuk '${exp.id}' harus '${exp.endpoint}'`);
      assert.equal(found.sourceType, "postgresql", `Source type untuk '${exp.id}' harus postgresql`);
      assert.equal(found.isLiveOperational, true, `Status operasional '${exp.id}' harus live operational`);
      assert.ok(found.coordinateFields.length > 0, `Sumber data '${exp.id}' harus mendefinisikan coordinateFields`);
    }
  });

  await t.test("3. Utilitas Helper Registri (isDataSourceRegistered & getDataSourceByTableName)", () => {
    assert.equal(isDataSourceRegistered("customers-geocoded"), true);
    assert.equal(isDataSourceRegistered("network-infrastructure"), true);
    assert.equal(isDataSourceRegistered("unknown-fake-id"), false);

    const custSource = getDataSourceByTableName("customers");
    assert.ok(custSource, "Wajib menemukan sumber data berdasarkan nama tabel 'customers'");
    assert.equal(custSource.id, "customers-geocoded");

    const cablesSource = getDataSourceByTableName("network_cables");
    assert.ok(cablesSource, "Wajib menemukan sumber data berdasarkan nama tabel 'network_cables'");
    assert.equal(cablesSource.id, "network-cables");

    const summary = getMapDataSourcesSummary();
    assert.equal(summary.totalSources, 4);
    assert.equal(summary.liveOperationalSources, 4);
    assert.ok(summary.registeredTables.includes("customers"));
    assert.ok(summary.registeredTables.includes("network_cables"));
  });

  await t.test("4. Endpoint API GET /api/map/data-source Menyajikan Registri", () => {
    assert.match(
      dataSourceRouteContent,
      /export function GET\(request:\s*Request\)/,
      "Endpoint wajib mengekspor handler GET",
    );
    assert.match(
      dataSourceRouteContent,
      /withApiSession\(request/,
      "Endpoint wajib diproteksi sesi dengan withApiSession",
    );
    assert.match(
      dataSourceRouteContent,
      /export const runtime\s*=\s*"nodejs"/,
      "Endpoint wajib berjalan di runtime nodejs",
    );
    assert.match(
      dataSourceRouteContent,
      /MAP_DATA_SOURCE_REGISTRY/,
      "Endpoint wajib menyertakan MAP_DATA_SOURCE_REGISTRY pada respon JSON",
    );
    assert.match(
      dataSourceRouteContent,
      /DATA_SOURCE_REGISTRY/,
      "Endpoint wajib menyertakan DATA_SOURCE_REGISTRY pada respon JSON",
    );
  });
});
