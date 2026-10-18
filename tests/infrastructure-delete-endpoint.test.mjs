import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deleteInfrastructurePointSchema } from "../src/validators/infrastructure-placement.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiItemRoutePath = path.resolve(__dirname, "../src/app/api/infrastructure/[id]/route.ts");
const mapApiItemRoutePath = path.resolve(__dirname, "../src/app/api/map/infrastructure/[id]/route.ts");
const apiRoutePath = path.resolve(__dirname, "../src/app/api/infrastructure/route.ts");
const mapApiRoutePath = path.resolve(__dirname, "../src/app/api/map/infrastructure/route.ts");
const servicePath = path.resolve(__dirname, "../src/services/map-infrastructure.service.ts");

test("Task: Buat endpoint hapus perangkat", async (t) => {
  const apiItemRouteContent = fs.readFileSync(apiItemRoutePath, "utf8");
  const mapApiItemRouteContent = fs.readFileSync(mapApiItemRoutePath, "utf8");
  const apiRouteContent = fs.readFileSync(apiRoutePath, "utf8");
  const mapApiRouteContent = fs.readFileSync(mapApiRoutePath, "utf8");
  const serviceContent = fs.readFileSync(servicePath, "utf8");

  await t.test("Validator: deleteInfrastructurePointSchema memvalidasi identifier perangkat", () => {
    const valid = deleteInfrastructurePointSchema.safeParse({ id: "odp-ttj-01" });
    assert.equal(valid.success, true, "ID valid harus diterima");
    if (valid.success) {
      assert.equal(valid.data.id, "odp-ttj-01");
    }

    const emptyId = deleteInfrastructurePointSchema.safeParse({ id: "   " });
    assert.equal(emptyId.success, false, "ID kosong atau spasi harus ditolak");

    const missingId = deleteInfrastructurePointSchema.safeParse({});
    assert.equal(missingId.success, false, "Objek tanpa ID harus ditolak");
  });

  await t.test("Service: deleteInfrastructurePoint menghapus titik, kabel terkait, dan mencatat audit log", () => {
    assert.match(
      serviceContent,
      /export async function deleteInfrastructurePoint/,
      "Service wajib mengekspor fungsi deleteInfrastructurePoint",
    );
    assert.match(
      serviceContent,
      /action: "delete_infrastructure_point"/,
      "Service wajib mencatat aksi audit log delete_infrastructure_point",
    );
    assert.match(
      serviceContent,
      /target: `infrastructure:\${id}`/,
      "Service wajib mencatat target audit log yang sesuai",
    );
    assert.match(
      serviceContent,
      /networkCables/,
      "Service wajib membersihkan kabel terhubung saat perangkat dihapus",
    );
    assert.match(
      serviceContent,
      /parentId:\s*null/,
      "Service wajib melepaskan parentId pada perangkat turunan",
    );
  });

  await t.test("API Endpoint: /api/infrastructure/[id] menyediakan handler DELETE terautentikasi", () => {
    assert.match(
      apiItemRouteContent,
      /export async function DELETE/,
      "Endpoint item wajib memiliki handler DELETE",
    );
    assert.match(
      apiItemRouteContent,
      /withApiSession\(request/,
      "Handler DELETE item wajib diamankan withApiSession",
    );
    assert.match(
      apiItemRouteContent,
      /deleteInfrastructurePoint\(id/,
      "Handler DELETE item wajib memanggil deleteInfrastructurePoint",
    );
  });

  await t.test("API Endpoint: /api/map/infrastructure/[id] konsisten menyediakan handler DELETE terautentikasi", () => {
    assert.match(
      mapApiItemRouteContent,
      /export async function DELETE/,
      "Map item route wajib memiliki handler DELETE",
    );
    assert.match(
      mapApiItemRouteContent,
      /deleteInfrastructurePoint\(id/,
      "Map item DELETE wajib memanggil deleteInfrastructurePoint",
    );
  });

  await t.test("API Endpoint: /api/infrastructure dan /api/map/infrastructure menyediakan handler DELETE koleksi", () => {
    assert.match(
      apiRouteContent,
      /export async function DELETE/,
      "Root infrastructure route wajib memiliki handler DELETE",
    );
    assert.match(
      mapApiRouteContent,
      /export async function DELETE/,
      "Map root infrastructure route wajib memiliki handler DELETE",
    );
    assert.match(
      apiRouteContent,
      /deleteInfrastructurePointSchema\.safeParse/,
      "Root route wajib memvalidasi body jika id tidak disertakan pada query",
    );
  });
});
