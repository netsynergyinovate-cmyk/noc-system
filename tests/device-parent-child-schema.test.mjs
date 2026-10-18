import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const schemaPath = path.resolve(__dirname, "../src/db/schema/network-infrastructure.ts");
const migrationPath = path.resolve(__dirname, "../drizzle/0026_device_relations.sql");
const validatorPath = path.resolve(__dirname, "../src/validators/device-relations.ts");
const servicePath = path.resolve(__dirname, "../src/services/device-relations.service.ts");
const routePath = path.resolve(__dirname, "../src/app/api/devices/relations/route.ts");
const idRoutePath = path.resolve(__dirname, "../src/app/api/devices/relations/[id]/route.ts");
const treeRoutePath = path.resolve(__dirname, "../src/app/api/devices/hierarchy/tree/route.ts");

test("Task: Buat Skema Relasi Induk Anak Perangkat (Backend)", async (t) => {
  const schemaContent = fs.readFileSync(schemaPath, "utf8");
  const migrationContent = fs.readFileSync(migrationPath, "utf8");
  const validatorContent = fs.readFileSync(validatorPath, "utf8");
  const serviceContent = fs.readFileSync(servicePath, "utf8");
  const routeContent = fs.readFileSync(routePath, "utf8");
  const idRouteContent = fs.readFileSync(idRoutePath, "utf8");
  const treeRouteContent = fs.readFileSync(treeRoutePath, "utf8");

  await t.test("1. Skema Tabel Drizzle & Migrasi SQL Relasi Induk-Anak Perangkat", () => {
    // Verifikasi skema Drizzle ORM
    assert.match(
      schemaContent,
      /export const networkDeviceRelations = pgTable\(\s*"network_device_relations"/,
      "Wajib mendefinisikan tabel networkDeviceRelations di schema",
    );
    assert.match(
      schemaContent,
      /parent_id[\s\S]*?references\(\(\) => networkInfrastructure\.id/,
      "Wajib mendefinisikan foreign key parent_id ke networkInfrastructure.id",
    );
    assert.match(
      schemaContent,
      /child_id[\s\S]*?references\(\(\) => networkInfrastructure\.id/,
      "Wajib mendefinisikan foreign key child_id ke networkInfrastructure.id",
    );
    assert.match(
      schemaContent,
      /relation_type[\s\S]*?hierarchy/,
      "Wajib mendukung relation_type dengan nilai default 'hierarchy'",
    );
    assert.match(
      schemaContent,
      /export const networkInfrastructureRelations = relations\(/,
      "Wajib mendefinisikan relasi Drizzle networkInfrastructureRelations",
    );
    assert.match(
      schemaContent,
      /export const networkDeviceRelationsRelations = relations\(/,
      "Wajib mendefinisikan relasi Drizzle networkDeviceRelationsRelations",
    );

    // Verifikasi berkas migrasi SQL
    assert.match(
      migrationContent,
      /CREATE TABLE IF NOT EXISTS "network_device_relations"/,
      "Berkas migrasi SQL 0026 wajib membuat tabel network_device_relations",
    );
    assert.match(
      migrationContent,
      /CONSTRAINT "network_device_rel_not_self" CHECK \("parent_id" != "child_id"\)/,
      "Berkas migrasi SQL wajib memuat check constraint pencegahan self-reference",
    );
    assert.match(
      migrationContent,
      /FOREIGN KEY \("parent_id"\) REFERENCES "network_infrastructure"\("id"\)/,
      "Berkas migrasi SQL wajib membuat foreign key parent_id",
    );
    assert.match(
      migrationContent,
      /FOREIGN KEY \("child_id"\) REFERENCES "network_infrastructure"\("id"\)/,
      "Berkas migrasi SQL wajib membuat foreign key child_id",
    );
  });

  await t.test("2. Validator Zod Relasi Induk-Anak (src/validators/device-relations.ts)", async () => {
    const {
      createDeviceRelationSchema,
      updateDeviceRelationSchema,
      queryDeviceRelationsSchema,
    } = await import("../src/validators/device-relations.ts");

    // Kasus valid: Pembuatan relasi hierarki ODC -> ODP
    const validRelation = createDeviceRelationSchema.safeParse({
      parentId: "odc-uuid-01",
      childId: "odp-uuid-01",
      relationType: "hierarchy",
      parentPort: "PORT-OUT-1",
      childPort: "PORT-IN-1",
      status: "active",
      details: { fiberCore: 4, attenuationDb: 0.8 },
    });
    assert.equal(validRelation.success, true, "Payload relasi valid harus lolos validasi Zod");
    if (validRelation.success) {
      assert.equal(validRelation.data.relationType, "hierarchy");
      assert.equal(validRelation.data.parentPort, "PORT-OUT-1");
    }

    // Kasus valid: Nilai default relationType dan status
    const validDefault = createDeviceRelationSchema.safeParse({
      parentId: "router-core-01",
      childId: "odc-hub-01",
    });
    assert.equal(validDefault.success, true, "Payload minimal harus sukses dengan nilai default");
    if (validDefault.success) {
      assert.equal(validDefault.data.relationType, "hierarchy");
      assert.equal(validDefault.data.status, "active");
    }

    // Kasus invalid: Self-reference (parentId === childId)
    const invalidSelf = createDeviceRelationSchema.safeParse({
      parentId: "same-device-uuid",
      childId: "same-device-uuid",
      relationType: "hierarchy",
    });
    assert.equal(
      invalidSelf.success,
      false,
      "Relasi self-reference (induk sama dengan anak) wajib ditolak",
    );

    // Kasus invalid: Kosong
    const invalidEmpty = createDeviceRelationSchema.safeParse({});
    assert.equal(invalidEmpty.success, false, "Payload kosong harus ditolak");

    // Kasus valid update
    const validUpdate = updateDeviceRelationSchema.safeParse({
      status: "standby",
      childPort: "IN-2",
    });
    assert.equal(validUpdate.success, true, "Update schema harus lolos untuk field parsial");

    // Kasus query filter
    const validQuery = queryDeviceRelationsSchema.safeParse({
      deviceId: "odp-01",
      relationType: "feeder",
    });
    assert.equal(validQuery.success, true, "Query schema harus menerima parameter filter");
  });

  await t.test("3. Aturan Hierarki Tipe Perangkat (validateHierarchyTypes)", async () => {
    const { validateHierarchyTypes } = await import(
      "../src/lib/hierarchy-rules.ts"
    );

    // Root node (server/router/olt) tidak boleh dijadikan anak
    const invalidRootAsChild = validateHierarchyTypes("odc", "server", "hierarchy");
    assert.equal(invalidRootAsChild.valid, false, "Server tidak boleh dijadikan anak");
    assert.match(
      invalidRootAsChild.message || "",
      /tingkat inti\/root/i,
      "Pesan error wajib mengindikasikan root tidak boleh jadi anak",
    );

    const invalidRouterAsChild = validateHierarchyTypes("odp", "router", "hierarchy");
    assert.equal(invalidRouterAsChild.valid, false, "Router tidak boleh dijadikan anak");

    // ODC menginduk ke Core Router -> Valid
    const validOdc = validateHierarchyTypes("router", "odc", "hierarchy");
    assert.equal(validOdc.valid, true, "ODC boleh menginduk ke Router");

    // ODC menginduk ke ODP -> Invalid (tier terbalik)
    const invalidOdcFromOdp = validateHierarchyTypes("odp", "odc", "hierarchy");
    assert.equal(invalidOdcFromOdp.valid, false, "ODC tidak boleh menginduk ke ODP");

    // ODP menginduk ke ODC -> Valid
    const validOdp = validateHierarchyTypes("odc", "odp", "hierarchy");
    assert.equal(validOdp.valid, true, "ODP boleh menginduk ke ODC");

    // Pole menginduk ke ODP -> Valid
    const validPole = validateHierarchyTypes("odp", "pole", "hierarchy");
    assert.equal(validPole.valid, true, "Tiang boleh menginduk ke ODP");

    // Relasi non-hierarki (misal backup/feeder interkoneksi) diperbolehkan
    const validBackup = validateHierarchyTypes("router", "router", "backup");
    assert.equal(validBackup.valid, true, "Tipe backup lintas perangkat harus diizinkan");
  });

  await t.test("4. Deteksi Siklus Relasi Hierarki (Loop Prevention)", () => {
    // Verifikasi struktur deteksi siklus di service
    assert.match(
      serviceContent,
      /export async function detectHierarchyCycle/,
      "Wajib mengekspor fungsi detectHierarchyCycle",
    );
    assert.match(
      serviceContent,
      /if\s*\(childId === targetParentId\)[\s\S]*?hasCycle:\s*true/,
      "Wajib mendeteksi siklus langsung ketika childId sama dengan targetParentId",
    );
    assert.match(
      serviceContent,
      /detectHierarchyCycle\(input\.childId,\s*input\.parentId\)/,
      "createDeviceRelation wajib memanggil detectHierarchyCycle sebelum menyimpan relasi hierarchy",
    );
  });

  await t.test("5. Service Device Relations (CRUD, Ancestors, dan Hierarchy Tree)", () => {
    assert.match(
      serviceContent,
      /export async function createDeviceRelation/,
      "Wajib menyediakan fungsi createDeviceRelation",
    );
    assert.match(
      serviceContent,
      /export async function getDeviceRelations/,
      "Wajib menyediakan fungsi getDeviceRelations",
    );
    assert.match(
      serviceContent,
      /export async function updateDeviceRelation/,
      "Wajib menyediakan fungsi updateDeviceRelation",
    );
    assert.match(
      serviceContent,
      /export async function deleteDeviceRelation/,
      "Wajib menyediakan fungsi deleteDeviceRelation",
    );
    assert.match(
      serviceContent,
      /export async function getDeviceAncestors/,
      "Wajib menyediakan fungsi getDeviceAncestors untuk silsilah leluhur",
    );
    assert.match(
      serviceContent,
      /export async function getDeviceHierarchyTree/,
      "Wajib menyediakan fungsi getDeviceHierarchyTree untuk pohon hierarki",
    );
    assert.match(
      serviceContent,
      /db[\s\S]*?\.update\(networkInfrastructure\)[\s\S]*?parentId:\s*input\.parentId/,
      "createDeviceRelation wajib menyinkronkan kolom parentId pada networkInfrastructure saat hierarchy dibuat",
    );
  });

  await t.test("6. Endpoint Rute API (/api/devices/relations, /[id], /hierarchy/tree)", () => {
    // /api/devices/relations
    assert.match(
      routeContent,
      /export async function GET\(request:\s*Request\)/,
      "Endpoint wajib mengekspor GET handler",
    );
    assert.match(
      routeContent,
      /export async function POST\(request:\s*Request\)/,
      "Endpoint wajib mengekspor POST handler",
    );
    assert.match(
      routeContent,
      /withApiSession\(request/,
      "Endpoint wajib diproteksi dengan withApiSession",
    );
    assert.match(
      routeContent,
      /createDeviceRelationSchema\.safeParse/,
      "POST wajib memvalidasi body dengan createDeviceRelationSchema",
    );

    // /api/devices/relations/[id]
    assert.match(
      idRouteContent,
      /export async function PATCH\(request:\s*Request/,
      "Endpoint [id] wajib mengekspor PATCH handler",
    );
    assert.match(
      idRouteContent,
      /export async function DELETE\(request:\s*Request/,
      "Endpoint [id] wajib mengekspor DELETE handler",
    );
    assert.match(
      idRouteContent,
      /withApiSession\(request/,
      "Endpoint [id] wajib diproteksi dengan withApiSession",
    );

    // /api/devices/hierarchy/tree
    assert.match(
      treeRouteContent,
      /export async function GET\(request:\s*Request\)/,
      "Endpoint hierarchy tree wajib mengekspor GET handler",
    );
    assert.match(
      treeRouteContent,
      /getDeviceHierarchyTree/,
      "Endpoint hierarchy tree wajib memanggil getDeviceHierarchyTree",
    );
  });
});
