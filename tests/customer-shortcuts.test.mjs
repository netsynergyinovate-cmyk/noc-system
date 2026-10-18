import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const panelPath = path.resolve(__dirname, "../src/components/map/customer-detail-panel.tsx");
const pagePath = path.resolve(__dirname, "../src/app/(protected)/app/pelanggan/peta/page.tsx");

test("Tambah pintasan pelanggan, CPE, dan billing", async (t) => {
  const panelContent = fs.readFileSync(panelPath, "utf8");
  const pageContent = fs.readFileSync(pagePath, "utf8");

  await t.test("CustomerDetailPanel memiliki kontainer pintasan operasional", () => {
    assert.match(
      panelContent,
      /data-testid="customer-shortcuts-container"/,
      "Panel harus memiliki kontainer pintasan operasional",
    );
  });

  await t.test("Pintasan Pelanggan di panel detail mengarahkan ke /app/pelanggan?search=...", () => {
    assert.match(
      panelContent,
      /data-testid="shortcut-customer-link"/,
      "Harus ada tombol pintasan pelanggan dengan data-testid='shortcut-customer-link'",
    );
    assert.match(
      panelContent,
      /href=\{`\/app\/pelanggan\?search=\$\{encodeURIComponent\(customer\.pppoeUsername\)\}`\}/,
      "Pintasan pelanggan harus memuat URL pencarian username PPPoE",
    );
    assert.match(
      panelContent,
      /data-testid="view-customer-link"/,
      "Alias data-testid='view-customer-link' harus tetap ada untuk kompatibilitas",
    );
  });

  await t.test("Pintasan CPE di panel detail mengarahkan ke /app/cpe?search=...", () => {
    assert.match(
      panelContent,
      /data-testid="shortcut-cpe-link"/,
      "Harus ada tombol pintasan CPE dengan data-testid='shortcut-cpe-link'",
    );
    assert.match(
      panelContent,
      /href=\{`\/app\/cpe\?search=\$\{encodeURIComponent\(customer\.onuDetails\?\.serialNumber \|\| customer\.pppoeUsername\)\}`\}/,
      "Pintasan CPE harus mengutamakan serial number ONU atau fallback ke username PPPoE",
    );
  });

  await t.test("Pintasan Billing di panel detail mengarahkan ke /app/billing?search=...", () => {
    assert.match(
      panelContent,
      /data-testid="shortcut-billing-link"/,
      "Harus ada tombol pintasan billing dengan data-testid='shortcut-billing-link'",
    );
    assert.match(
      panelContent,
      /href=\{`\/app\/billing\?search=\$\{encodeURIComponent\(customer\.pppoeUsername\)\}`\}/,
      "Pintasan billing harus memuat URL pencarian tagihan pelanggan",
    );
  });

  await t.test("Halaman peta sebaran menyediakan pintasan cepat tingkat halaman (Pelanggan, CPE, Billing)", () => {
    assert.match(
      pageContent,
      /data-testid="page-shortcut-pelanggan"/,
      "Halaman harus memiliki tombol pintasan cepat ke tabel pelanggan",
    );
    assert.match(
      pageContent,
      /href="\/app\/pelanggan"/,
      "Pintasan halaman harus mengarah ke /app/pelanggan",
    );

    assert.match(
      pageContent,
      /data-testid="page-shortcut-cpe"/,
      "Halaman harus memiliki tombol pintasan cepat ke manajemen CPE",
    );
    assert.match(
      pageContent,
      /href="\/app\/cpe"/,
      "Pintasan halaman harus mengarah ke /app/cpe",
    );

    assert.match(
      pageContent,
      /data-testid="page-shortcut-billing"/,
      "Halaman harus memiliki tombol pintasan cepat ke modul billing",
    );
    assert.match(
      pageContent,
      /href="\/app\/billing"/,
      "Pintasan halaman harus mengarah ke /app/billing",
    );
  });
});
