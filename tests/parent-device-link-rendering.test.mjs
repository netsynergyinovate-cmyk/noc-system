import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const networkMapPath = path.resolve(
  __dirname,
  "../src/components/map/network-map.tsx",
);
const servicePath = path.resolve(
  __dirname,
  "../src/services/network-map.service.ts",
);
const hierarchyBoardPath = path.resolve(
  __dirname,
  "../src/components/map/hierarchy-map-board.tsx",
);

test("Task: Gambar garis penghubung perangkat ke induk", async (t) => {
  const networkMapContent = fs.readFileSync(networkMapPath, "utf8");
  const serviceContent = fs.readFileSync(servicePath, "utf8");
  const hierarchyBoardContent = fs.readFileSync(hierarchyBoardPath, "utf8");

  await t.test(
    "Service & Schema: NetworkInfrastructurePoint memiliki parentId dan parentName",
    () => {
      assert.match(
        serviceContent,
        /parentId\?: string \| null;/,
        "Tipe NetworkInfrastructurePoint wajib mendefinisikan field parentId",
      );
      assert.match(
        serviceContent,
        /parentName\?: string \| null;/,
        "Tipe NetworkInfrastructurePoint wajib mendefinisikan field parentName",
      );
      assert.match(
        serviceContent,
        /from\(networkInfrastructure\)/,
        "getNetworkMapData wajib memuat data riil dari tabel network_infrastructure",
      );
    },
  );

  await t.test(
    "Komponen NetworkMap: Menghubungkan perangkat ke induk berdasarkan parentId",
    () => {
      assert.match(
        networkMapContent,
        /parent-link-\$\{parent\.id\}-\$\{infra\.id\}/,
        "NetworkMap wajib membuat relasi kabel ID parent-link-{parentId}-{childId}",
      );
      assert.match(
        networkMapContent,
        /Relasi Induk: \$\{parent\.name\} ➔ \$\{infra\.name\}/,
        "Nama relasi kabel wajib mendokumentasikan arah dari induk ke perangkat",
      );
      assert.match(
        networkMapContent,
        /type\s*[:=]\s*"backbone"/,
        "Mendukung klasifikasi kabel backbone (Core/Router ke ODC/OLT)",
      );
      assert.match(
        networkMapContent,
        /type\s*[:=]\s*"feeder"/,
        "Mendukung klasifikasi kabel feeder (ODC/OLT ke ODP)",
      );
      assert.match(
        networkMapContent,
        /type\s*[:=]\s*"distribution"/,
        "Mendukung klasifikasi kabel distribusi percabangan/tiang",
      );
      assert.match(
        networkMapContent,
        /type\s*[:=]\s*"drop"/,
        "Mendukung klasifikasi kabel drop optik (ODP ke pelanggan)",
      );
    },
  );

  await t.test(
    "Komponen NetworkMap: Efek visual sorotan garis (highlight) dan halo glow",
    () => {
      assert.match(
        networkMapContent,
        /#22d3ee/,
        "Kabel yang disorot wajib menggunakan warna neon aktif (#22d3ee)",
      );
      assert.match(
        networkMapContent,
        /cable\.isHighlighted/,
        "Mendukung deteksi status isHighlighted saat simpul atau induk dipilih",
      );
      assert.match(
        networkMapContent,
        /data-testid=\{`cable-tooltip-\$\{cable\.id\}`\}/,
        "Polyline kabel wajib dilengkapi tooltip informatif",
      );
    },
  );

  await t.test(
    "Komponen HierarchyMapBoard: Meneruskan parentId & parentName ke layer peta",
    () => {
      assert.match(
        hierarchyBoardContent,
        /parentId: root\.id,\s*parentName: root\.name/,
        "HierarchyMapBoard wajib meneruskan parentId & parentName ODC ke root",
      );
      assert.match(
        hierarchyBoardContent,
        /parentId: odc\.id,\s*parentName: odc\.name/,
        "HierarchyMapBoard wajib meneruskan parentId & parentName ODP ke ODC",
      );
    },
  );

  await t.test(
    "Algoritma Penarikan Garis: Evaluasi In-Memory Relasi Induk-Anak Lengkap",
    () => {
      const mockInfra = [
        {
          id: "core-gw-1",
          name: "Core Gateway BGP",
          type: "router",
          latitude: -2.5786,
          longitude: 101.2185,
          status: "active",
        },
        {
          id: "odc-hub-1",
          name: "ODC-CAB-01",
          type: "odc",
          latitude: -2.578,
          longitude: 101.219,
          parentId: "core-gw-1",
          status: "active",
        },
        {
          id: "odp-box-1",
          name: "ODP-TTJ-01",
          type: "odp",
          latitude: -2.577,
          longitude: 101.22,
          parentId: "odc-hub-1",
          status: "active",
        },
        {
          id: "pole-01",
          name: "Tiang-TTJ-01",
          type: "pole",
          latitude: -2.5768,
          longitude: 101.2202,
          parentId: "odp-box-1",
          status: "active",
        },
      ];

      const mockCustomers = [
        {
          id: "cust-01",
          name: "Ahmad Dahlan",
          odpName: "ODP-TTJ-01",
          latitude: -2.5765,
          longitude: 101.2205,
          isOnline: true,
        },
      ];

      // Algoritma penghubung perangkat ke induk
      function computeParentLinks(infraList, custs, selectedInfraId) {
        const routes = [];
        for (const infra of infraList) {
          if (!infra.parentId) continue;
          const parent = infraList.find((p) => p.id === infra.parentId);
          if (parent) {
            const isHighlighted =
              selectedInfraId === infra.id || selectedInfraId === parent.id;
            routes.push({
              id: `parent-link-${parent.id}-${infra.id}`,
              sourceId: parent.id,
              targetId: infra.id,
              type:
                parent.type === "router"
                  ? "backbone"
                  : parent.type === "odc"
                    ? "feeder"
                    : "distribution",
              isHighlighted,
            });
          }
        }

        for (const cust of custs) {
          const odp = infraList.find((i) => i.name === cust.odpName);
          if (odp) {
            routes.push({
              id: `drop-${cust.id}`,
              sourceId: odp.id,
              targetId: cust.id,
              type: "drop",
              isHighlighted: selectedInfraId === odp.id,
            });
          }
        }
        return routes;
      }

      // 1. Uji koneksi tanpa seleksi
      const routesNormal = computeParentLinks(mockInfra, mockCustomers, null);
      assert.equal(
        routesNormal.length,
        4,
        "Harus menghasilkan 4 jalur relasi induk-anak",
      );
      assert.equal(routesNormal[0].id, "parent-link-core-gw-1-odc-hub-1");
      assert.equal(routesNormal[0].type, "backbone");
      assert.equal(routesNormal[1].id, "parent-link-odc-hub-1-odp-box-1");
      assert.equal(routesNormal[1].type, "feeder");
      assert.equal(routesNormal[2].id, "parent-link-odp-box-1-pole-01");
      assert.equal(routesNormal[2].type, "distribution");
      assert.equal(routesNormal[3].id, "drop-cust-01");
      assert.equal(routesNormal[3].type, "drop");

      // 2. Uji seleksi ODP: link ke ODC dan drop ke pelanggan harus tersorot (isHighlighted = true)
      const routesHighlight = computeParentLinks(
        mockInfra,
        mockCustomers,
        "odp-box-1",
      );
      const feederLink = routesHighlight.find(
        (r) => r.id === "parent-link-odc-hub-1-odp-box-1",
      );
      assert.equal(
        feederLink.isHighlighted,
        true,
        "Jalur dari ODC ke ODP terpilih harus tersorot",
      );
      const dropLink = routesHighlight.find((r) => r.id === "drop-cust-01");
      assert.equal(
        dropLink.isHighlighted,
        true,
        "Kabel drop ke pelanggan di bawah ODP harus tersorot",
      );
    },
  );
});
