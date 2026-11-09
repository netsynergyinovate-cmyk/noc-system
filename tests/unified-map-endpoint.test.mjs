import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Task: Buat Endpoint Data Peta Terpadu (Backend)", async (t) => {
  const networkRoutePath = path.join(
    process.cwd(),
    "src/app/api/map/network/route.ts",
  );
  const unifiedRoutePath = path.join(
    process.cwd(),
    "src/app/api/map/unified/route.ts",
  );
  const servicePath = path.join(
    process.cwd(),
    "src/services/real-map-data.service.ts",
  );

  const networkRouteContent = fs.readFileSync(networkRoutePath, "utf-8");
  const unifiedRouteContent = fs.readFileSync(unifiedRoutePath, "utf-8");
  const serviceContent = fs.readFileSync(servicePath, "utf-8");

  await t.test("1. Endpoint API Data Peta Terpadu (/api/map/network)", () => {
    assert.match(
      networkRouteContent,
      /export function GET\(request:\s*Request\)/,
      "Endpoint wajib mengekspor handler GET",
    );
    assert.match(
      networkRouteContent,
      /withApiSession\(request/,
      "Endpoint wajib diproteksi sesi autentikasi dengan withApiSession",
    );
    assert.match(
      networkRouteContent,
      /getCompleteRealMapData/,
      "Endpoint wajib memanggil service backend getCompleteRealMapData",
    );
    assert.match(
      networkRouteContent,
      /includeCables/,
      "Endpoint wajib mendukung opsi includeCables",
    );
    assert.match(
      networkRouteContent,
      /includeHierarchy/,
      "Endpoint wajib mendukung opsi includeHierarchy untuk relasi hierarki",
    );
    assert.match(
      networkRouteContent,
      /searchQuery/,
      "Endpoint wajib mendukung parameter pencarian teks (search)",
    );
    assert.match(
      networkRouteContent,
      /statusFilter/,
      "Endpoint wajib mendukung filter status perangkat/pelanggan",
    );
  });

  await t.test("2. Endpoint API Alias Terpadu (/api/map/unified)", () => {
    assert.match(
      unifiedRouteContent,
      /export function GET\(request:\s*Request\)/,
      "Endpoint /api/map/unified wajib mengekspor handler GET",
    );
    assert.match(
      unifiedRouteContent,
      /withApiSession\(request/,
      "Endpoint /api/map/unified wajib diproteksi sesi autentikasi",
    );
    assert.match(
      unifiedRouteContent,
      /getCompleteRealMapData/,
      "Endpoint /api/map/unified wajib memanggil getCompleteRealMapData",
    );
    assert.match(
      unifiedRouteContent,
      /includeCables/,
      "Endpoint /api/map/unified wajib mendukung opsi includeCables",
    );
    assert.match(
      unifiedRouteContent,
      /includeHierarchy/,
      "Endpoint /api/map/unified wajib mendukung opsi includeHierarchy",
    );
  });

  await t.test(
    "3. Service getCompleteRealMapData: Agregasi Multi-Tabel PostgreSQL",
    () => {
      assert.match(
        serviceContent,
        /db\.select\(\)[\s\S]*?\.from\(networkInfrastructure\)/,
        "Service wajib membaca tabel network_infrastructure fisik",
      );
      assert.match(
        serviceContent,
        /\.from\(customers\)/,
        "Service wajib membaca tabel customers dengan geocoding riil",
      );
      assert.match(
        serviceContent,
        /\.from\(networkCables\)/,
        "Service wajib membaca bentangan kabel network_cables",
      );
      assert.match(
        serviceContent,
        /getDeviceHierarchyTree/,
        "Service wajib mendukung pemanggilan getDeviceHierarchyTree untuk relasi hierarki",
      );
      assert.match(
        serviceContent,
        /totalCustomers[\s\S]*?totalDevices[\s\S]*?totalCables/,
        "Service wajib mengkalkulasi metrik ringkasan telemetri terpadu",
      );
      assert.match(
        serviceContent,
        /isRealData:\s*true/,
        "Service wajib menandai isRealData bernilai true saat membaca database operasional",
      );
      assert.doesNotMatch(
        serviceContent,
        /dummy_node|dummy_customer|fake_point/i,
        "Service dilarang menyematkan data dummy palsu (kepatuhan zero-dummy)",
      );
    },
  );
});
