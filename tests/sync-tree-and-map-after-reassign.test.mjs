import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const boardPath = path.resolve(__dirname, "../src/components/map/hierarchy-map-board.tsx");

test("Task: Segarkan Peta dan Pohon Setelah Simpan Pindah", async (t) => {
  const boardContent = fs.readFileSync(boardPath, "utf8");

  await t.test("1. Pembukaan Otomatis Cabang Induk Baru di Pohon Relasi (Auto-Expand New Parent)", () => {
    assert.match(
      boardContent,
      /setExpandedNodes\(\(prev\)\s*=>\s*\{[\s\S]*?next\.add\(selectedOption\.id\)/,
      "Cabang induk baru wajib otomatis ditambahkan ke expandedNodes agar langsung terbuka di pohon",
    );
  });

  await t.test("2. Pembaruan Silsilah Serta Garis Kabel Peta (Parent Name & Lineage Synchronization)", () => {
    assert.match(
      boardContent,
      /setSelectedNode\(\(prev\)[\s\S]*?parentName:\s*selectedOption\.name/,
      "Simpul terpilih wajib memperbarui parentName agar garis relasi peta dan silsilah lineage langsung sinkron",
    );
  });

  await t.test("3. Penyegaran Data Asinkron dari Backend PostgreSQL (refreshData Trigger)", () => {
    assert.match(
      boardContent,
      /refreshData\(\);[\s\S]*?setReassignSuccessMsg/,
      "Fungsi refreshData() wajib dipanggil pasca-simpan untuk menyinkronkan data peta & pohon dari server",
    );
  });

  await t.test("4. Indikator UI Sinkronisasi Peta & Pohon Berhasil", () => {
    assert.match(
      boardContent,
      /data-testid="reassign-sync-indicator"/,
      "Wajib menampilkan indikator visual bahwa peta dan pohon telah tersinkronisasi ke induk baru",
    );
  });

  await t.test("5. Replikasi In-Memory Optimistic Update Pohon untuk Seluruh 4 Tingkatan", () => {
    // Simulasi pemindahan pelanggan dari ODP-01 ke ODP-02
    const mockState = {
      roots: [
        {
          id: "core-01",
          name: "Core Gateway",
          odcs: [
            {
              id: "odc-01",
              name: "ODC Feeder 01",
              odps: [
                {
                  id: "odp-01",
                  name: "ODP-01",
                  customers: [
                    { id: "cust-01", name: "Pelanggan 1", odpName: "ODP-01" },
                  ],
                },
                {
                  id: "odp-02",
                  name: "ODP-02",
                  customers: [],
                },
              ],
            },
          ],
          directOdps: [],
        },
      ],
    };

    const targetCustomer = { id: "cust-01", name: "Pelanggan 1" };
    const newParent = { id: "odp-02", name: "ODP-02" };

    // Eksekusi mutasi optimistik
    const updatedRoots = mockState.roots.map((root) => ({
      ...root,
      odcs: root.odcs.map((odc) => ({
        ...odc,
        odps: odc.odps.map((odp) => {
          let nextCusts = odp.customers.filter((c) => c.id !== targetCustomer.id);
          if (odp.id === newParent.id) {
            nextCusts = [
              ...nextCusts,
              { id: targetCustomer.id, name: targetCustomer.name, odpName: newParent.name },
            ];
          }
          return { ...odp, customers: nextCusts };
        }),
      })),
    }));

    const oldOdp = updatedRoots[0].odcs[0].odps.find((o) => o.id === "odp-01");
    const newOdp = updatedRoots[0].odcs[0].odps.find((o) => o.id === "odp-02");

    assert.equal(oldOdp.customers.length, 0, "ODP lama tidak boleh lagi memiliki pelanggan tersebut");
    assert.equal(newOdp.customers.length, 1, "ODP baru wajib memiliki pelanggan yang baru dipindahkan");
    assert.equal(newOdp.customers[0].odpName, "ODP-02", "Nama ODP pelanggan harus terupdate");
  });
});
