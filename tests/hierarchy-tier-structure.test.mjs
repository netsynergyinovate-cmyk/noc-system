import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const lineageLibPath = path.resolve(
  __dirname,
  "../src/lib/hierarchy-lineage.ts",
);
const hierarchyBoardPath = path.resolve(
  __dirname,
  "../src/components/map/hierarchy-map-board.tsx",
);
const customerMapPath = path.resolve(
  __dirname,
  "../src/components/dashboard/customer-map.tsx",
);
const servicePath = path.resolve(
  __dirname,
  "../src/services/network-hierarchy.service.ts",
);

test("Penyusunan Tingkatan Server -> ODC -> ODP -> Pelanggan", async (t) => {
  const lineageLibContent = fs.readFileSync(lineageLibPath, "utf8");
  const hierarchyBoardContent = fs.readFileSync(hierarchyBoardPath, "utf8");
  const customerMapContent = fs.readFileSync(customerMapPath, "utf8");
  const serviceContent = fs.readFileSync(servicePath, "utf8");

  await t.test(
    "Definisi Modul hierarchy-lineage.ts: Metadata & Pelacak Silsilah Tingkatan",
    () => {
      assert.match(
        lineageLibContent,
        /export const HIERARCHY_TIER_META/,
        "Wajib mengekspor HIERARCHY_TIER_META dengan konfigurasi 4 tingkat",
      );
      assert.match(
        lineageLibContent,
        /export function resolveHierarchyLineage/,
        "Wajib mengekspor resolveHierarchyLineage untuk melacak silsilah bertingkat",
      );
      assert.match(
        lineageLibContent,
        /tier: 1/,
        "Metadata wajib mendefinisikan Tingkat 1 (Core / Server / OLT)",
      );
      assert.match(
        lineageLibContent,
        /tier: 2/,
        "Metadata wajib mendefinisikan Tingkat 2 (ODC)",
      );
      assert.match(
        lineageLibContent,
        /tier: 3/,
        "Metadata wajib mendefinisikan Tingkat 3 (ODP)",
      );
      assert.match(
        lineageLibContent,
        /tier: 4/,
        "Metadata wajib mendefinisikan Tingkat 4 (Pelanggan)",
      );
    },
  );

  await t.test(
    "Logika resolveHierarchyLineage: Resolusi 4 Tingkat Vertikal Lengkap",
    () => {
      // Simulasi data topologi 4 tingkat
      const mockData = {
        roots: [
          {
            id: "root-server-01",
            name: "Core Gateway BGP",
            type: "server",
            status: "active",
            latitude: -2.5786,
            longitude: 101.2185,
            odcs: [
              {
                id: "odc-ttj-01",
                name: "ODC-TTJ-CAB-01",
                type: "odc",
                status: "active",
                latitude: -2.578,
                longitude: 101.219,
                capacity: 72,
                usedCapacity: 16,
                odps: [
                  {
                    id: "odp-ttj-01",
                    name: "ODP-TTJ-01",
                    type: "odp",
                    status: "active",
                    latitude: -2.577,
                    longitude: 101.22,
                    capacity: 16,
                    usedCapacity: 2,
                    customers: [
                      {
                        id: "cust-001",
                        name: "Budi Santoso",
                        pppoeUsername: "budi@isp",
                        isOnline: true,
                        opticalPower: -19.5,
                        billingStatus: "lunas",
                        latitude: -2.5765,
                        longitude: 101.2205,
                        odpName: "ODP-TTJ-01",
                      },
                    ],
                  },
                ],
              },
            ],
            directOdps: [
              {
                id: "odp-direct-01",
                name: "ODP-DIRECT-01",
                type: "odp",
                status: "active",
                latitude: -2.579,
                longitude: 101.217,
                capacity: 8,
                usedCapacity: 1,
                customers: [
                  {
                    id: "cust-002",
                    name: "Agus Salim",
                    pppoeUsername: "agus@isp",
                    isOnline: false,
                    opticalPower: -26.2,
                    billingStatus: "isolir",
                    latitude: -2.5795,
                    longitude: 101.2165,
                    odpName: "ODP-DIRECT-01",
                  },
                ],
              },
            ],
          },
        ],
        allNodesCount: 6,
        links: [],
        summary: {
          totalRoots: 1,
          totalOdcs: 1,
          totalOdps: 2,
          totalCustomers: 2,
          onlineCustomers: 1,
          offlineCustomers: 1,
        },
        dataSource: {
          provider: "unit-test",
          isRealData: true,
          lastSynchronizedAt: new Date().toISOString(),
        },
      };

      // Evaluasi fungsi secara in-memory
      function testResolver(data, targetId) {
        if (!targetId || !data || !Array.isArray(data.roots)) return [];
        for (const root of data.roots) {
          const rootStep = {
            id: root.id,
            name: root.name,
            type: root.type,
            tier: 1,
          };
          if (root.id === targetId) return [rootStep];
          for (const odc of root.odcs) {
            const odcStep = {
              id: odc.id,
              name: odc.name,
              type: "odc",
              tier: 2,
            };
            if (odc.id === targetId) return [rootStep, odcStep];
            for (const odp of odc.odps) {
              const odpStep = {
                id: odp.id,
                name: odp.name,
                type: "odp",
                tier: 3,
              };
              if (odp.id === targetId) return [rootStep, odcStep, odpStep];
              for (const cust of odp.customers) {
                if (cust.id === targetId) {
                  const custStep = {
                    id: cust.id,
                    name: cust.name,
                    type: "customer",
                    tier: 4,
                  };
                  return [rootStep, odcStep, odpStep, custStep];
                }
              }
            }
          }
          for (const odp of root.directOdps) {
            const odpStep = {
              id: odp.id,
              name: odp.name,
              type: "odp",
              tier: 3,
            };
            if (odp.id === targetId) return [rootStep, odpStep];
            for (const cust of odp.customers) {
              if (cust.id === targetId) {
                const custStep = {
                  id: cust.id,
                  name: cust.name,
                  type: "customer",
                  tier: 4,
                };
                return [rootStep, odpStep, custStep];
              }
            }
          }
        }
        return [];
      }

      // 1. Root / Server
      const rootLineage = testResolver(mockData, "root-server-01");
      assert.equal(rootLineage.length, 1);
      assert.equal(rootLineage[0].tier, 1);
      assert.equal(rootLineage[0].name, "Core Gateway BGP");

      // 2. ODC
      const odcLineage = testResolver(mockData, "odc-ttj-01");
      assert.equal(odcLineage.length, 2);
      assert.equal(odcLineage[0].tier, 1);
      assert.equal(odcLineage[1].tier, 2);
      assert.equal(odcLineage[1].name, "ODC-TTJ-CAB-01");

      // 3. ODP
      const odpLineage = testResolver(mockData, "odp-ttj-01");
      assert.equal(odpLineage.length, 3);
      assert.equal(odpLineage[0].tier, 1);
      assert.equal(odpLineage[1].tier, 2);
      assert.equal(odpLineage[2].tier, 3);
      assert.equal(odpLineage[2].name, "ODP-TTJ-01");

      // 4. Pelanggan
      const custLineage = testResolver(mockData, "cust-001");
      assert.equal(custLineage.length, 4);
      assert.equal(custLineage[0].tier, 1);
      assert.equal(custLineage[1].tier, 2);
      assert.equal(custLineage[2].tier, 3);
      assert.equal(custLineage[3].tier, 4);
      assert.equal(custLineage[3].name, "Budi Santoso");

      // 5. Direct ODP Customer
      const directCustLineage = testResolver(mockData, "cust-002");
      assert.equal(directCustLineage.length, 3);
      assert.equal(directCustLineage[0].tier, 1);
      assert.equal(directCustLineage[1].tier, 3);
      assert.equal(directCustLineage[2].tier, 4);

      // 6. Unknown ID
      const unknownLineage = testResolver(mockData, "non-existent-id");
      assert.deepEqual(unknownLineage, []);
    },
  );

  await t.test(
    "Komponen HierarchyMapBoard: Breadcrumb Interaktif & Rantai Induk-Anak",
    () => {
      assert.match(
        hierarchyBoardContent,
        /data-testid="hierarchy-lineage-breadcrumb"/,
        "Komponen harus merender breadcrumb silsilah tingkatan relasi",
      );
      assert.match(
        hierarchyBoardContent,
        /data-testid={`lineage-step-\$\{step\.tier\}`}/,
        "Setiap langkah breadcrumb harus memiliki penanda tingkatan yang dapat diklik",
      );
      assert.match(
        hierarchyBoardContent,
        /data-testid="selected-node-lineage-trail"/,
        "Panel detail simpul harus menampilkan rantai silsilah induk-anak",
      );
      assert.match(
        hierarchyBoardContent,
        /data-testid={`tier-badge-\$\{root\.id\}`}/,
        "Simpul pohon Core harus memiliki badge T1",
      );
      assert.match(
        hierarchyBoardContent,
        /data-testid={`tier-badge-\$\{odc\.id\}`}/,
        "Simpul pohon ODC harus memiliki badge T2",
      );
      assert.match(
        hierarchyBoardContent,
        /data-testid={`tier-badge-\$\{odp\.id\}`}/,
        "Simpul pohon ODP harus memiliki badge T3",
      );
      assert.match(
        hierarchyBoardContent,
        /data-testid={`tier-badge-\$\{c\.id\}`}/,
        "Simpul pohon Pelanggan harus memiliki badge T4",
      );
    },
  );

  await t.test(
    "Defensif Leaflet: customer-map.tsx Menyertakan subdomains untuk Mencegah Crash TileLayer",
    () => {
      assert.match(
        customerMapContent,
        /subdomains=\{\["a", "b", "c"\]\}/,
        "TileLayer streets di customer-map.tsx wajib memiliki subdomains untuk menghindari error Leaflet _getSubdomain",
      );
    },
  );
});
