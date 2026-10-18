import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Tata Panel Informasi dan Legenda Posisi Tetap (Fixed Map Legend & Quick Info)", async (t) => {
  const legendFile = path.resolve("src/components/map/network-map-legend.tsx");
  const mapFile = path.resolve("src/components/map/network-map.tsx");

  assert.equal(fs.existsSync(legendFile), true, "File network-map-legend.tsx harus ada");
  assert.equal(fs.existsSync(mapFile), true, "File network-map.tsx harus ada");

  const legendContent = fs.readFileSync(legendFile, "utf-8");
  const mapContent = fs.readFileSync(mapFile, "utf-8");

  await t.test("Komponen NetworkMapLegend memiliki dok posisi tetap dan fitur lipat/buka (collapsible)", () => {
    assert.match(legendContent, /data-testid="fixed-map-legend"/, "Harus memiliki kontainer posisi tetap data-testid fixed-map-legend");
    assert.match(legendContent, /data-testid="toggle-legend-collapse"/, "Harus memiliki tombol lipat/buka legenda");
    assert.match(legendContent, /const \[isExpanded, setIsExpanded\] = useState/, "Mendukung toggle expands/collapse");
  });

  await t.test("Tersedia tab navigasi kategori legenda (simbol titik, kapasitas kabel, dan kontrol lapisan)", () => {
    assert.match(legendContent, /data-testid="legend-tab-symbols"/, "Harus ada tab Penanda & Titik");
    assert.match(legendContent, /data-testid="legend-tab-cables"/, "Harus ada tab Kapasitas Kabel");
    assert.match(legendContent, /data-testid="legend-tab-layers"/, "Harus ada tab Visibilitas Lapisan");
  });

  await t.test("Simbol penanda perangkat infrastruktur dan status pelanggan lengkap dengan atribut testid", () => {
    assert.match(legendContent, /data-testid="marker-legend-symbols"/, "Harus ada kontainer simbol penanda");
    assert.match(legendContent, /data-testid="infra-legend-router"/, "Harus ada legenda Core Router");
    assert.match(legendContent, /data-testid="infra-legend-olt"/, "Harus ada legenda OLT Fiber");
    assert.match(legendContent, /data-testid="infra-legend-odc"/, "Harus ada legenda ODC");
    assert.match(legendContent, /data-testid="infra-legend-odp"/, "Harus ada legenda ODP");
    assert.match(legendContent, /data-testid="infra-legend-pole"/, "Harus ada legenda Tiang");
  });

  await t.test("Rincian kapasitas kabel optik dan kontrol lapisan pada dok posisi tetap", () => {
    assert.match(legendContent, /data-testid="cable-legend-details"/, "Harus ada kontainer rincian kabel");
    assert.match(legendContent, /Backbone Optik/, "Mencakup legenda Backbone 48-96C");
    assert.match(legendContent, /Feeder Distribusi/, "Mencakup legenda Feeder 16-24C");
    assert.match(legendContent, /data-testid="toggle-customers-dock"/, "Harus ada toggle lapisan pelanggan");
    assert.match(legendContent, /data-testid="toggle-infrastructure-dock"/, "Harus ada toggle lapisan infrastruktur");
    assert.match(legendContent, /data-testid="toggle-cables-dock"/, "Harus ada toggle lapisan kabel");
  });

  await t.test("network-map.tsx mengintegrasikan dan mengekspor NetworkMapLegend", () => {
    assert.match(mapContent, /import\s*\{[^}]*NetworkMapLegend[^}]*\}\s*from\s*"[^"]*network-map-legend"/, "Harus mengimpor NetworkMapLegend");
    assert.match(mapContent, /<NetworkMapLegend/, "Harus merender NetworkMapLegend di template");
    assert.match(mapContent, /export\s*\{[^}]*NetworkMapLegend[^}]*\}/, "Harus mengekspor NetworkMapLegend");
  });
});
