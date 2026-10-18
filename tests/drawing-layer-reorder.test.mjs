import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PANEL_PATH = path.resolve(
  process.cwd(),
  "src/components/map/drawing-layer-manager-panel.tsx",
);
const BOARD_PATH = path.resolve(
  process.cwd(),
  "src/components/map/drawing-layer-map-board.tsx",
);

test("DrawingLayerManagerPanel memiliki prop onReorderLayers dan kontrol reorder tumpukan lapisan", () => {
  const content = fs.readFileSync(PANEL_PATH, "utf8");

  // Periksa deklarasi prop onReorderLayers
  assert.match(
    content,
    /onReorderLayers\?:\s*\(reorderedLayers:\s*MapDrawingLayer\[\]\)\s*=>\s*void/,
    "DrawingLayerManagerPanelProps harus menyertakan onReorderLayers",
  );

  // Periksa data-testid tombol navigasi urutan
  assert.ok(
    content.includes('data-testid={`move-layer-top-${layer.id}`}'),
    "Harus ada tombol bawa ke paling atas (move-layer-top)",
  );
  assert.ok(
    content.includes('data-testid={`zindex-up-${layer.id}`}'),
    "Harus ada tombol naik satu tingkat (zindex-up)",
  );
  assert.ok(
    content.includes('data-testid={`zindex-down-${layer.id}`}'),
    "Harus ada tombol turun satu tingkat (zindex-down)",
  );
  assert.ok(
    content.includes('data-testid={`move-layer-bottom-${layer.id}`}'),
    "Harus ada tombol bawa ke paling bawah (move-layer-bottom)",
  );
  assert.ok(
    content.includes('data-testid={`layer-stack-level-${layer.id}`}'),
    "Harus ada badge indikator tingkat tumpukan lapisan",
  );

  // Periksa import icon ChevronsUp dan ChevronsDown
  assert.match(content, /ChevronsUp/, "Harus mengimpor icon ChevronsUp");
  assert.match(content, /ChevronsDown/, "Harus mengimpor icon ChevronsDown");
});

test("Simulasi logika handleReorderLayer: swap up/down, bring to top/bottom, dan normalisasi zIndex", () => {
  // Simulasi 3 lapisan
  const initialLayers = [
    { id: "layer-1", name: "Kabel Backbone", zIndex: 3 },
    { id: "layer-2", name: "Distribusi ODP", zIndex: 2 },
    { id: "layer-3", name: "Drop Core Pelanggan", zIndex: 1 },
  ];

  function reorder(layers, layerId, direction) {
    const sorted = [...layers].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
    const currentIndex = sorted.findIndex((l) => l.id === layerId);
    if (currentIndex === -1) return layers;

    if (direction === "up" && currentIndex > 0) {
      const temp = sorted[currentIndex];
      sorted[currentIndex] = sorted[currentIndex - 1];
      sorted[currentIndex - 1] = temp;
    } else if (direction === "down" && currentIndex < sorted.length - 1) {
      const temp = sorted[currentIndex];
      sorted[currentIndex] = sorted[currentIndex + 1];
      sorted[currentIndex + 1] = temp;
    } else if (direction === "top" && currentIndex > 0) {
      const [item] = sorted.splice(currentIndex, 1);
      sorted.unshift(item);
    } else if (direction === "bottom" && currentIndex < sorted.length - 1) {
      const [item] = sorted.splice(currentIndex, 1);
      sorted.push(item);
    }

    const total = sorted.length;
    return sorted.map((l, idx) => ({
      ...l,
      zIndex: total - idx,
    }));
  }

  // 1. Move layer-3 to top
  const resTop = reorder(initialLayers, "layer-3", "top");
  assert.equal(resTop[0].id, "layer-3");
  assert.equal(resTop[0].zIndex, 3);
  assert.equal(resTop[1].id, "layer-1");
  assert.equal(resTop[1].zIndex, 2);
  assert.equal(resTop[2].id, "layer-2");
  assert.equal(resTop[2].zIndex, 1);

  // 2. Move layer-1 to bottom
  const resBottom = reorder(initialLayers, "layer-1", "bottom");
  assert.equal(resBottom[0].id, "layer-2");
  assert.equal(resBottom[0].zIndex, 3);
  assert.equal(resBottom[1].id, "layer-3");
  assert.equal(resBottom[1].zIndex, 2);
  assert.equal(resBottom[2].id, "layer-1");
  assert.equal(resBottom[2].zIndex, 1);

  // 3. Move layer-2 up
  const resUp = reorder(initialLayers, "layer-2", "up");
  assert.equal(resUp[0].id, "layer-2");
  assert.equal(resUp[0].zIndex, 3);
  assert.equal(resUp[1].id, "layer-1");
  assert.equal(resUp[1].zIndex, 2);

  // 4. Move layer-2 down
  const resDown = reorder(initialLayers, "layer-2", "down");
  assert.equal(resDown[1].id, "layer-3");
  assert.equal(resDown[2].id, "layer-2");
  assert.equal(resDown[2].zIndex, 1);
});

test("DrawingLayerMapBoard menyambungkan onReorderLayers ke DrawingLayerManagerPanel", () => {
  const content = fs.readFileSync(BOARD_PATH, "utf8");

  assert.ok(
    content.includes("handleReorderLayers"),
    "DrawingLayerMapBoard harus mendefinisikan handleReorderLayers",
  );
  assert.ok(
    content.includes("onReorderLayers={handleReorderLayers}"),
    "DrawingLayerMapBoard harus meneruskan onReorderLayers ke DrawingLayerManagerPanel",
  );
});
