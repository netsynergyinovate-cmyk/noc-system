import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiItemRoutePath = path.resolve(__dirname, "../src/app/api/infrastructure/[id]/route.ts");
const mapApiItemRoutePath = path.resolve(__dirname, "../src/app/api/map/infrastructure/[id]/route.ts");
const servicePath = path.resolve(__dirname, "../src/services/map-infrastructure.service.ts");

test("Task: Buat endpoint detail perangkat lengkap", async (t) => {
  const apiItemRouteContent = fs.readFileSync(apiItemRoutePath, "utf8");
  const mapApiItemRouteContent = fs.readFileSync(mapApiItemRoutePath, "utf8");
  const serviceContent = fs.readFileSync(servicePath, "utf8");

  await t.test("Service: Memastikan getInfrastructureDetail diekspor dengan struktur data lengkap", () => {
    assert.match(
      serviceContent,
      /export async function getInfrastructureDetail/,
      "Service wajib mengekspor fungsi getInfrastructureDetail",
    );
    assert.match(
      serviceContent,
      /export interface InfrastructureDetailResult/,
      "Service wajib menyediakan interface InfrastructureDetailResult",
    );
    assert.match(
      serviceContent,
      /export interface ConnectedCustomerSummary/,
      "Service wajib menyediakan interface ConnectedCustomerSummary",
    );
    assert.match(
      serviceContent,
      /export interface InfrastructureHierarchyNode/,
      "Service wajib menyediakan interface InfrastructureHierarchyNode",
    );
    assert.match(
      serviceContent,
      /export interface ConnectedCableSummary/,
      "Service wajib menyediakan interface ConnectedCableSummary",
    );
  });

  await t.test("Service: Mendukung relasi induk-anak, kabel, pelanggan terhubung, dan statistik perangkat", () => {
    // Relasi parent & children
    assert.match(
      serviceContent,
      /parentNode/,
      "Fungsi detail harus memetakan perangkat induk (parent)",
    );
    assert.match(
      serviceContent,
      /childrenNodes/,
      "Fungsi detail harus memetakan perangkat turunan (children)",
    );
    // Kabel terhubung
    assert.match(
      serviceContent,
      /cablesList/,
      "Fungsi detail harus menyertakan daftar kabel optik terhubung",
    );
    // Pelanggan terhubung & stats
    assert.match(
      serviceContent,
      /customerList/,
      "Fungsi detail harus mengumpulkan daftar pelanggan pada ODP",
    );
    assert.match(
      serviceContent,
      /customerStats/,
      "Fungsi detail harus menghitung statistik pelanggan (online/offline/billing)",
    );
    // Utilisasi kapasitas
    assert.match(
      serviceContent,
      /utilizationPercent/,
      "Fungsi detail harus menghitung persentase pemakaian kapasitas",
    );
    // Hardware stats
    assert.match(
      serviceContent,
      /hardwareStats/,
      "Fungsi detail harus menyertakan metrik hardware untuk Router/OLT",
    );
  });

  await t.test("API Endpoint: /api/infrastructure/[id] menyediakan GET, PATCH, dan DELETE terautentikasi", () => {
    assert.match(
      apiItemRouteContent,
      /export async function GET/,
      "Endpoint harus memiliki handler GET untuk detail perangkat",
    );
    assert.match(
      apiItemRouteContent,
      /export async function PATCH/,
      "Endpoint harus memiliki handler PATCH untuk modifikasi posisi perangkat",
    );
    assert.match(
      apiItemRouteContent,
      /export async function DELETE/,
      "Endpoint harus memiliki handler DELETE untuk menghapus perangkat",
    );
    assert.match(
      apiItemRouteContent,
      /withApiSession\(request/,
      "Seluruh handler wajib diamankan dengan withApiSession",
    );
    assert.match(
      apiItemRouteContent,
      /getInfrastructureDetail\(id/,
      "Handler GET harus memanggil getInfrastructureDetail",
    );
    assert.match(
      apiItemRouteContent,
      /status:\s*404/,
      "Handler GET harus mengembalikan status 404 jika perangkat tidak ditemukan",
    );
  });

  await t.test("API Endpoint: /api/map/infrastructure/[id] konsisten menyediakan handler GET terautentikasi", () => {
    assert.match(
      mapApiItemRouteContent,
      /export async function GET/,
      "Endpoint map infrastructure/[id] wajib memiliki handler GET",
    );
    assert.match(
      mapApiItemRouteContent,
      /getInfrastructureDetail\(id/,
      "Handler GET map infrastructure/[id] wajib memanggil getInfrastructureDetail",
    );
    assert.match(
      mapApiItemRouteContent,
      /status:\s*404/,
      "Handler GET map infrastructure/[id] wajib mengembalikan 404 jika id tidak ditemukan",
    );
  });
});
