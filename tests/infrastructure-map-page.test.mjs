import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Halaman Peta Infrastruktur dengan Data Nyata dari Backend", async (t) => {
  const pageFile = path.resolve("src/app/(protected)/app/peta/page.tsx");
  assert.equal(fs.existsSync(pageFile), true, "File src/app/(protected)/app/peta/page.tsx harus ada");
  const content = fs.readFileSync(pageFile, "utf-8");

  await t.test("Proteksi autentikasi sesi dan pengambilan data nyata backend", () => {
    assert.match(content, /requireSession\(\)/, "Harus memanggil requireSession() untuk proteksi otorisasi");
    assert.match(content, /getNetworkMapData\(\)/, "Harus mengambil data jaringan dari getNetworkMapData()");
    assert.match(content, /data-testid="peta-infrastruktur-page"/, "Elemen kontainer harus memiliki data-testid");
    assert.match(content, /data-testid="data-source-badge"/, "Harus menampilkan badge sumber data PostgreSQL Live");
    assert.match(content, /PostgreSQL Live/, "Menyatakan sumber data live PostgreSQL secara transparan");
  });

  await t.test("Ringkasan metrik infrastruktur jaringan nyata", () => {
    assert.match(content, /data-testid="infra-metrics-grid"/, "Harus menyediakan grid ringkasan metrik");
    assert.match(content, /data-testid="infra-total-devices"/, "Harus menampilkan total perangkat infrastruktur");
    assert.match(content, /data-testid="infra-total-routers"/, "Harus menampilkan total Core Router");
    assert.match(content, /data-testid="infra-total-olts"/, "Harus menampilkan total OLT Fiber");
    assert.match(content, /data-testid="infra-total-odps"/, "Harus menampilkan total ODP distribusi");
    assert.match(content, /data-testid="infra-connected-clients"/, "Harus menampilkan titik pelanggan terhubung");
  });

  await t.test("Pintasan navigasi operasional dua arah ke modul router, OLT/CPE, dan peta pelanggan", () => {
    assert.match(content, /data-testid="shortcut-router-link"/, "Harus ada pintasan ke /app/router");
    assert.match(content, /href="\/app\/router"/, "Pintasan router harus mengarah ke /app/router");

    assert.match(content, /data-testid="shortcut-cpe-link"/, "Harus ada pintasan ke /app/cpe");
    assert.match(content, /href="\/app\/cpe"/, "Pintasan OLT harus mengarah ke /app/cpe");

    assert.match(content, /data-testid="shortcut-customer-map-link"/, "Harus ada pintasan ke /app/pelanggan/peta");
    assert.match(content, /href="\/app\/pelanggan\/peta"/, "Pintasan peta pelanggan harus mengarah ke /app/pelanggan/peta");
  });

  await t.test("Integrasi komponen peta Leaflet dan dukungan fokus perangkat via URL", () => {
    assert.match(content, /readFocusId/, "Mendukung pembacaan query param focus");
    assert.match(content, /NetworkMapLeafletLoader/, "Merender peta melalui loader dinamis Leaflet");
    assert.match(content, /initialFocusId=\{focusId \?\? undefined\}/, "Meneruskan initialFocusId ke peta");
  });

  await t.test("Alias rute /app/infrastruktur/peta terhubung langsung ke implementasi", () => {
    const aliasFile = path.resolve("src/app/(protected)/app/infrastruktur/peta/page.tsx");
    assert.equal(fs.existsSync(aliasFile), true, "File alias infrastruktur/peta/page.tsx harus ada");
    const aliasContent = fs.readFileSync(aliasFile, "utf-8");
    assert.match(aliasContent, /import PetaInfrastrukturPage.*from "@\/app\/\(protected\)\/app\/peta\/page"/);
    assert.match(aliasContent, /export default PetaInfrastrukturPage/);
  });
});
