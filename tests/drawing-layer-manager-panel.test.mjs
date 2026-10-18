import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Task: Buat panel kelola daftar lapisan gambar (Fase 5)", async (t) => {
  const panelPath = path.join(
    process.cwd(),
    "src/components/map/drawing-layer-manager-panel.tsx",
  );
  const boardPath = path.join(
    process.cwd(),
    "src/components/map/drawing-layer-map-board.tsx",
  );

  const panelContent = fs.readFileSync(panelPath, "utf-8");
  const boardContent = fs.readFileSync(boardPath, "utf-8");

  await t.test("1. Struktur Dasar Komponen DrawingLayerManagerPanel", () => {
    assert.match(
      panelContent,
      /export function DrawingLayerManagerPanel/,
      "Wajib mengekspor komponen DrawingLayerManagerPanel",
    );
    assert.match(
      panelContent,
      /data-testid="layer-management-panel"/,
      "Wajib menyertakan kontainer layer-management-panel",
    );
    assert.match(
      panelContent,
      /data-testid="layer-count-badge"/,
      "Wajib menampilkan badge jumlah lapisan",
    );
    assert.match(
      panelContent,
      /data-testid="add-layer-button"/,
      "Wajib menyediakan tombol tambah lapisan baru",
    );
  });

  await t.test("2. Form Tambah Lapisan Baru dengan Validasi Input", () => {
    assert.match(
      panelContent,
      /data-testid="create-layer-form"/,
      "Wajib menyediakan form pembuatan lapisan baru",
    );
    assert.match(
      panelContent,
      /data-testid="new-layer-name-input"/,
      "Wajib menyediakan input nama lapisan baru",
    );
    assert.match(
      panelContent,
      /data-testid="new-layer-description-input"/,
      "Wajib menyediakan input deskripsi/keterangan lapisan baru",
    );
    assert.match(
      panelContent,
      /data-testid="submit-new-layer-button"/,
      "Wajib menyediakan tombol submit lapisan baru",
    );
  });

  await t.test("3. Fitur Interaktif Per Lapisan: Pilih Aktif, Rename, Visibilitas, Duplikasi & Hapus", () => {
    assert.match(
      panelContent,
      /data-testid=\{`select-layer-\$\{layer\.id\}`\}/,
      "Wajib menyediakan tombol pemilihan lapisan kanvas aktif",
    );
    assert.match(
      panelContent,
      /data-testid=\{`rename-layer-\$\{layer\.id\}`\}/,
      "Wajib menyediakan tombol ubah nama (rename) lapisan",
    );
    assert.match(
      panelContent,
      /data-testid=\{`rename-input-\$\{layer\.id\}`\}/,
      "Wajib menyediakan input inline saat rename lapisan berlangsung",
    );
    assert.match(
      panelContent,
      /data-testid=\{`toggle-visibility-\$\{layer\.id\}`\}/,
      "Wajib menyediakan toggle sembunyikan/tampilkan visibilitas",
    );
    assert.match(
      panelContent,
      /data-testid=\{`duplicate-layer-\$\{layer\.id\}`\}/,
      "Wajib menyediakan aksi duplikasi lapisan beserta objek bentuknya",
    );
    assert.match(
      panelContent,
      /data-testid=\{`delete-layer-\$\{layer\.id\}`\}/,
      "Wajib menyediakan tombol hapus lapisan",
    );
  });

  await t.test("4. Kontrol Transparansi (Opacity) & Pengaturan Urutan Tumpukan (Z-Index)", () => {
    assert.match(
      panelContent,
      /data-testid=\{`opacity-slider-\$\{layer\.id\}`\}/,
      "Wajib menyediakan slider kontrol opasitas 10% - 100%",
    );
    assert.match(
      panelContent,
      /data-testid=\{`zindex-input-\$\{layer\.id\}`\}/,
      "Wajib menyediakan input manual nilai urutan z-index",
    );
    assert.match(
      panelContent,
      /data-testid=\{`zindex-up-\$\{layer\.id\}`\}/,
      "Wajib menyediakan tombol naikkan urutan tumpukan (Bring Forward)",
    );
    assert.match(
      panelContent,
      /data-testid=\{`zindex-down-\$\{layer\.id\}`\}/,
      "Wajib menyediakan tombol turunkan urutan tumpukan (Send Backward)",
    );
    assert.match(
      panelContent,
      /data-testid=\{`layer-shapes-count-\$\{layer\.id\}`\}/,
      "Wajib menampilkan jumlah objek bentuk di setiap lapisan",
    );
  });

  await t.test("5. Fitur Pencarian Lapisan & Aksi Batch", () => {
    assert.match(
      panelContent,
      /data-testid="search-layers-input"/,
      "Wajib menyediakan input filter pencarian nama lapisan",
    );
    assert.match(
      panelContent,
      /data-testid=\{allVisible \? "hide-all-layers-btn" : "show-all-layers-btn"\}/,
      "Wajib menyediakan tombol aksi batch tampilkan/sembunyikan semua lapisan",
    );
  });

  await t.test("6. Integrasi Bersih di DrawingLayerMapBoard", () => {
    assert.match(
      boardContent,
      /import\s*\{\s*DrawingLayerManagerPanel\s*\}\s*from\s*["']@\/components\/map\/drawing-layer-manager-panel["']/,
      "DrawingLayerMapBoard wajib mengimpor DrawingLayerManagerPanel",
    );
    assert.match(
      boardContent,
      /<DrawingLayerManagerPanel[\s\S]*?layers=\{layers\}[\s\S]*?activeLayerId=\{activeLayerId\}[\s\S]*?onSelectActiveLayer=\{setActiveLayerId\}[\s\S]*?onUpdateLayer=\{handleUpdateLayer\}[\s\S]*?onCreateLayer=\{handleCreateLayer\}[\s\S]*?onDeleteLayer=\{handleDeleteLayer\}/,
      "DrawingLayerMapBoard wajib meneruskan state dan callback ke DrawingLayerManagerPanel",
    );
    assert.match(
      boardContent,
      /handleDuplicateLayer/,
      "DrawingLayerMapBoard wajib menyediakan fungsi duplikasi lapisan ke API",
    );
    assert.match(
      boardContent,
      /handleToggleAllVisibility/,
      "DrawingLayerMapBoard wajib menyediakan fungsi toggle batch visibilitas seluruh lapisan",
    );
  });
});
