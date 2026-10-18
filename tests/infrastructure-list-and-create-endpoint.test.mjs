import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createInfrastructurePointSchema,
  infrastructureQuerySchema,
} from "../src/validators/infrastructure-placement.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiRoutePath = path.resolve(__dirname, "../src/app/api/infrastructure/route.ts");
const mapApiRoutePath = path.resolve(__dirname, "../src/app/api/map/infrastructure/route.ts");
const servicePath = path.resolve(__dirname, "../src/services/map-infrastructure.service.ts");

test("Task: Buat endpoint daftar dan tambah perangkat infrastruktur", async (t) => {
  const apiRouteContent = fs.readFileSync(apiRoutePath, "utf8");
  const mapApiRouteContent = fs.readFileSync(mapApiRoutePath, "utf8");
  const serviceContent = fs.readFileSync(servicePath, "utf8");

  await t.test("Validator: infrastructureQuerySchema memvalidasi query parameter secara ketat", () => {
    const validQuery = infrastructureQuerySchema.safeParse({
      type: "odp",
      status: "active",
      search: "ODP-KRB",
      limit: "25",
      offset: "0",
      forceMock: "false",
    });
    assert.equal(validQuery.success, true, "Query valid harus diterima");
    if (validQuery.success) {
      assert.equal(validQuery.data.type, "odp");
      assert.equal(validQuery.data.status, "active");
      assert.equal(validQuery.data.search, "ODP-KRB");
      assert.equal(validQuery.data.limit, 25);
      assert.equal(validQuery.data.offset, 0);
      assert.equal(validQuery.data.forceMock, false);
    }

    const aliasQuery = infrastructureQuerySchema.safeParse({
      q: "Mawar",
    });
    assert.equal(aliasQuery.success, true);
    if (aliasQuery.success) {
      assert.equal(aliasQuery.data.q, "Mawar");
    }

    const invalidType = infrastructureQuerySchema.safeParse({
      type: "invalid_hardware_type",
    });
    assert.equal(invalidType.success, false, "Tipe tidak valid harus ditolak");
  });

  await t.test("Validator: createInfrastructurePointSchema memvalidasi payload tambah perangkat", () => {
    const validPayload = createInfrastructurePointSchema.safeParse({
      name: "ODP-TEST-01",
      type: "odp",
      latitude: -2.5786,
      longitude: 101.2185,
      status: "active",
      notes: "Testing ODP baru",
    });
    assert.equal(validPayload.success, true, "Payload valid harus diterima");

    const invalidCoords = createInfrastructurePointSchema.safeParse({
      name: "ODP-ERR-01",
      type: "odp",
      latitude: -95.0, // Di luar range
      longitude: 101.2185,
    });
    assert.equal(invalidCoords.success, false, "Koordinat di luar jangkauan harus ditolak");

    const missingName = createInfrastructurePointSchema.safeParse({
      type: "odp",
      latitude: -2.5786,
      longitude: 101.2185,
    });
    assert.equal(missingName.success, false, "Nama wajib diisi");
  });

  await t.test("Service: getInfrastructureList dan createInfrastructurePoint diimplementasikan secara komprehensif", () => {
    assert.match(
      serviceContent,
      /export async function getInfrastructureList/,
      "Service wajib menyediakan fungsi getInfrastructureList",
    );
    assert.match(
      serviceContent,
      /export async function createInfrastructurePoint/,
      "Service wajib menyediakan fungsi createInfrastructurePoint",
    );
    assert.match(
      serviceContent,
      /export interface InfrastructureSummary/,
      "Service wajib menyediakan interface ringkasan (InfrastructureSummary)",
    );
    assert.match(
      serviceContent,
      /export interface InfrastructureListResult/,
      "Service wajib menyediakan interface hasil daftar perangkat (InfrastructureListResult)",
    );
    assert.match(
      serviceContent,
      /networkInfrastructure/,
      "Service wajib membaca dan menulis ke tabel PostgreSQL networkInfrastructure",
    );
    assert.match(
      serviceContent,
      /action: "create_infrastructure_point"/,
      "Service wajib mencatat audit log saat menambahkan perangkat baru",
    );
  });

  await t.test("API Endpoint: /api/infrastructure menyediakan handler GET dan POST terautentikasi", () => {
    assert.match(
      apiRouteContent,
      /export async function GET/,
      "Endpoint harus memiliki handler GET",
    );
    assert.match(
      apiRouteContent,
      /export async function POST/,
      "Endpoint harus memiliki handler POST",
    );
    assert.match(
      apiRouteContent,
      /withApiSession\(request/,
      "GET dan POST harus diamankan dengan withApiSession",
    );
    assert.match(
      apiRouteContent,
      /createInfrastructurePointSchema\.safeParse/,
      "POST harus memvalidasi payload menggunakan createInfrastructurePointSchema",
    );
    assert.match(
      apiRouteContent,
      /infrastructureQuerySchema\.safeParse/,
      "GET harus memvalidasi query menggunakan infrastructureQuerySchema",
    );
    assert.match(
      apiRouteContent,
      /getInfrastructureList/,
      "GET harus memanggil getInfrastructureList dari service",
    );
    assert.match(
      apiRouteContent,
      /createInfrastructurePoint/,
      "POST harus memanggil createInfrastructurePoint dari service",
    );
  });

  await t.test("API Endpoint: /api/map/infrastructure konsisten dan mendukung parameter filter", () => {
    assert.match(
      mapApiRouteContent,
      /getInfrastructureList/,
      "Endpoint map infrastructure harus memanfaatkan getInfrastructureList",
    );
    assert.match(
      mapApiRouteContent,
      /createInfrastructurePointSchema\.safeParse/,
      "Endpoint map infrastructure harus mendukung penambahan titik via POST",
    );
  });
});
