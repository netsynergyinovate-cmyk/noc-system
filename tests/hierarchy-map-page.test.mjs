import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const topologiPagePath = path.resolve(__dirname, "../src/app/(protected)/app/topologi/page.tsx");
const topologiAliasPagePath = path.resolve(__dirname, "../src/app/(protected)/app/peta/topologi/page.tsx");
const hierarchyBoardPath = path.resolve(__dirname, "../src/components/map/hierarchy-map-board.tsx");
const servicePath = path.resolve(__dirname, "../src/services/network-hierarchy.service.ts");
const apiHierarchyPath = path.resolve(__dirname, "../src/app/api/map/hierarchy/route.ts");
const apiInfraHierarchyPath = path.resolve(__dirname, "../src/app/api/infrastructure/hierarchy/route.ts");

test("Task: Bangun halaman peta susunan bertingkat dengan data nyata dari backend", async (t) => {
  const topologiPageContent = fs.readFileSync(topologiPagePath, "utf8");
  const topologiAliasPageContent = fs.readFileSync(topologiAliasPagePath, "utf8");
  const hierarchyBoardContent = fs.readFileSync(hierarchyBoardPath, "utf8");
  const serviceContent = fs.readFileSync(servicePath, "utf8");
  const apiHierarchyContent = fs.readFileSync(apiHierarchyPath, "utf8");
  const apiInfraHierarchyContent = fs.readFileSync(apiInfraHierarchyPath, "utf8");

  await t.test("Service: getNetworkHierarchyData menyusun struktur bertingkat 4 tingkat lengkap", () => {
    assert.match(
      serviceContent,
      /export async function getNetworkHierarchyData/,
      "Service wajib mengekspor getNetworkHierarchyData",
    );
    assert.match(
      serviceContent,
      /export interface HierarchyRootNode/,
      "Service wajib menyediakan tipe HierarchyRootNode (Tingkat 1)",
    );
    assert.match(
      serviceContent,
      /export interface HierarchyOdcNode/,
      "Service wajib menyediakan tipe HierarchyOdcNode (Tingkat 2)",
    );
    assert.match(
      serviceContent,
      /export interface HierarchyOdpNode/,
      "Service wajib menyediakan tipe HierarchyOdpNode (Tingkat 3)",
    );
    assert.match(
      serviceContent,
      /export interface HierarchyCustomerLeaf/,
      "Service wajib menyediakan tipe HierarchyCustomerLeaf (Tingkat 4)",
    );
    assert.match(
      serviceContent,
      /export interface HierarchyConnectionLink/,
      "Service wajib memetakan garis relasi koneksi bertingkat",
    );
  });

  await t.test("Komponen HierarchyMapBoard: Menyediakan UI interaktif, KPI cards, dan filter tingkat", () => {
    assert.match(
      hierarchyBoardContent,
      /data-testid="hierarchy-map-board"/,
      "Komponen harus memiliki data-testid='hierarchy-map-board'",
    );
    assert.match(
      hierarchyBoardContent,
      /data-testid="hierarchy-kpi-cards"/,
      "Komponen harus merender kontainer kartu metrik tingkat",
    );
    assert.match(
      hierarchyBoardContent,
      /data-testid="kpi-total-roots"/,
      "Komponen harus merender metrik simpul pusat / Core",
    );
    assert.match(
      hierarchyBoardContent,
      /data-testid="kpi-total-odcs"/,
      "Komponen harus merender metrik kabin ODC",
    );
    assert.match(
      hierarchyBoardContent,
      /data-testid="kpi-total-odps"/,
      "Komponen harus merender metrik kotak ODP",
    );
    assert.match(
      hierarchyBoardContent,
      /data-testid="kpi-total-customers"/,
      "Komponen harus merender metrik pelanggan akhir",
    );
    assert.match(
      hierarchyBoardContent,
      /data-testid="hierarchy-tier-filters"/,
      "Komponen harus merender saringan tingkat (1, 2, 3, 4, semua)",
    );
    assert.match(
      hierarchyBoardContent,
      /data-testid="hierarchy-tree-panel"/,
      "Komponen harus memiliki panel pohon relasi kolapsibel",
    );
    assert.match(
      hierarchyBoardContent,
      /data-testid="toggle-hierarchy-links-button"/,
      "Komponen harus memiliki tombol toggle garis relasi bertingkat",
    );
    assert.match(
      hierarchyBoardContent,
      /NetworkMapLeafletLoader/,
      "Komponen harus mengintegrasikan kanvas peta Leaflet",
    );
  });

  await t.test("Halaman Server: /app/topologi terproteksi sesi dan membaca data nyata backend", () => {
    assert.match(
      topologiPageContent,
      /requireSession\(\)/,
      "Halaman topologi wajib diproteksi requireSession()",
    );
    assert.match(
      topologiPageContent,
      /getNetworkHierarchyData\(\)/,
      "Halaman topologi wajib memanggil getNetworkHierarchyData() backend",
    );
    assert.match(
      topologiPageContent,
      /data-testid="peta-topologi-page"/,
      "Halaman topologi wajib memiliki container dengan data-testid='peta-topologi-page'",
    );
    assert.match(
      topologiAliasPageContent,
      /import PetaTopologiPage/,
      "Rute alias /app/peta/topologi harus terhubung langsung ke PetaTopologiPage",
    );
  });

  await t.test("API Endpoints: /api/map/hierarchy dan /api/infrastructure/hierarchy terautentikasi", () => {
    assert.match(
      apiHierarchyContent,
      /export async function GET/,
      "Endpoint map hierarchy wajib menyediakan method GET",
    );
    assert.match(
      apiHierarchyContent,
      /withApiSession/,
      "Endpoint map hierarchy wajib diamankan withApiSession",
    );
    assert.match(
      apiInfraHierarchyContent,
      /export async function GET/,
      "Endpoint infrastructure hierarchy wajib menyediakan method GET",
    );
    assert.match(
      apiInfraHierarchyContent,
      /withApiSession/,
      "Endpoint infrastructure hierarchy wajib diamankan withApiSession",
    );
  });
});
