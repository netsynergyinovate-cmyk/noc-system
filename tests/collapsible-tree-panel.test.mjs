import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const hierarchyBoardPath = path.resolve(
  __dirname,
  "../src/components/map/hierarchy-map-board.tsx",
);

test("Fitur Panel Pohon Relasi Buka-Tutup (Collapsible Tree Panel)", async (t) => {
  const content = fs.readFileSync(hierarchyBoardPath, "utf8");

  await t.test("1. Keberadaan State dan Kontrol Buka-Tutup Panel", () => {
    assert.match(
      content,
      /const \[isTreeOpen,\s*setIsTreeOpen\]\s*=\s*useState\(true\)/,
      "Wajib memiliki state isTreeOpen dengan inisialisasi default true",
    );
    assert.match(
      content,
      /data-testid="toggle-hierarchy-tree-button"/,
      "Wajib memiliki tombol toggle utama di bar kontrol",
    );
    assert.match(
      content,
      /isTreeOpen \? "Tutup Pohon" : "Buka Pohon"/,
      "Label tombol toggle bar harus berganti antara Tutup Pohon dan Buka Pohon",
    );
  });

  await t.test("2. Tombol Tutup Panel di Header Pohon Relasi", () => {
    assert.match(
      content,
      /data-testid="close-tree-panel-button"/,
      "Header panel pohon wajib memiliki tombol tutup panel",
    );
    assert.match(
      content,
      /onClick=\{\(\) => setIsTreeOpen\(false\)\}/,
      "Tombol tutup panel harus memicu setIsTreeOpen(false)",
    );
  });

  await t.test(
    "3. Tombol Terapung Buka Pohon di Kanvas Peta saat Panel Tertutup",
    () => {
      assert.match(
        content,
        /data-testid="floating-open-tree-button"/,
        "Kanvas peta wajib memiliki tombol terapung floating-open-tree-button saat panel tertutup",
      );
      assert.match(
        content,
        /!isTreeOpen\s*&&\s*\(/,
        "Tombol terapung hanya dirender saat isTreeOpen bernilai false",
      );
      assert.match(
        content,
        /onClick=\{\(\) => setIsTreeOpen\(true\)\}/,
        "Tombol terapung wajib memicu setIsTreeOpen(true)",
      );
    },
  );

  await t.test(
    "4. Aksi Ekspansi Massal: Buka Semua & Tutup Semua Cabang",
    () => {
      assert.match(
        content,
        /data-testid="expand-all-tree-button"/,
        "Wajib memiliki tombol Buka Semua (expand-all-tree-button)",
      );
      assert.match(
        content,
        /data-testid="collapse-all-tree-button"/,
        "Wajib memiliki tombol Tutup Semua (collapse-all-tree-button)",
      );
      assert.match(
        content,
        /const expandAllNodes\s*=\s*useCallback/,
        "Wajib memiliki fungsi expandAllNodes yang mengumpulkan semua ID simpul ke dalam Set",
      );
      assert.match(
        content,
        /const collapseAllNodes\s*=\s*useCallback\(\(\)\s*=>\s*\{[\s\S]*?setExpandedNodes\(new Set\(\)\);/,
        "Wajib memiliki fungsi collapseAllNodes yang mengosongkan Set node ter-expand",
      );
    },
  );

  await t.test(
    "5. Simulasi Logika Expand All & Collapse All pada Struktur Pohon",
    () => {
      const mockTreeData = {
        roots: [
          {
            id: "core-01",
            name: "Core Router",
            odcs: [
              {
                id: "odc-01",
                name: "ODC-01",
                odps: [
                  { id: "odp-01", name: "ODP-01" },
                  { id: "odp-02", name: "ODP-02" },
                ],
              },
            ],
            directOdps: [{ id: "odp-direct-01", name: "ODP Direct 01" }],
          },
        ],
      };

      // Replikasi logika expandAllNodes
      const expandedSet = new Set();
      mockTreeData.roots.forEach((r) => {
        expandedSet.add(r.id);
        r.odcs.forEach((odc) => {
          expandedSet.add(odc.id);
          odc.odps.forEach((odp) => expandedSet.add(odp.id));
        });
        r.directOdps.forEach((odp) => expandedSet.add(odp.id));
      });

      assert.equal(
        expandedSet.size,
        5,
        "Semua 5 node (1 root + 1 odc + 2 odp + 1 direct odp) harus terdaftar di set expand",
      );
      assert.ok(expandedSet.has("core-01"));
      assert.ok(expandedSet.has("odc-01"));
      assert.ok(expandedSet.has("odp-01"));
      assert.ok(expandedSet.has("odp-02"));
      assert.ok(expandedSet.has("odp-direct-01"));

      // Replikasi collapseAllNodes
      const collapsedSet = new Set();
      assert.equal(collapsedSet.size, 0, "Set setelah collapse harus kosong");
    },
  );
});
