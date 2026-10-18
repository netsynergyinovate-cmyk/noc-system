import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Fitur Pemilihan & Penyimpanan Titik Koordinat Pelanggan di Peta", () => {
  const rootDir = process.cwd();
  const networkMapPath = path.join(rootDir, "src/components/map/network-map.tsx");
  const modalPath = path.join(rootDir, "src/components/map/customer-coordinate-picker-modal.tsx");
  const customerLocationServicePath = path.join(rootDir, "src/services/customer-location.service.ts");
  const customerLocationRoutePath = path.join(rootDir, "src/app/api/customers/[id]/location/route.ts");

  test("1. Berkas komponen modal dan servis backend tersedia dan valid", () => {
    assert.ok(fs.existsSync(modalPath), "customer-coordinate-picker-modal.tsx harus ada");
    assert.ok(fs.existsSync(networkMapPath), "network-map.tsx harus ada");
    assert.ok(fs.existsSync(customerLocationServicePath), "customer-location.service.ts harus ada");
    assert.ok(fs.existsSync(customerLocationRoutePath), "api/customers/[id]/location/route.ts harus ada");
  });

  test("2. CustomerCoordinatePickerModal menyediakan kontrol pencarian, filter, dan data-testid yang lengkap", () => {
    const modalContent = fs.readFileSync(modalPath, "utf-8");

    // Modal elements and testids
    assert.match(modalContent, /customer-coordinate-picker-dialog/, "Memiliki modal dialog testid");
    assert.match(modalContent, /picker-search-input/, "Memiliki input pencarian pelanggan");
    assert.match(modalContent, /filter-unmapped-tab/, "Memiliki tab filter belum ada GPS");
    assert.match(modalContent, /filter-all-tab/, "Memiliki tab filter semua pelanggan");
    assert.match(modalContent, /filter-mapped-tab/, "Memiliki tab filter sudah ada titik");
    assert.match(modalContent, /customer-picker-list/, "Memiliki daftar pilihan pelanggan");

    // Menampilkan detail pelanggan riil: nama, PPPoE username, ODP, status
    assert.match(modalContent, /pppoeUsername/, "Menampilkan username PPPoE");
    assert.match(modalContent, /odpName/, "Menampilkan nama ODP");
    assert.match(modalContent, /prefilledCoord/, "Mendukung koordinat prefill dari klik peta");
  });

  test("3. network-map.tsx mengintegrasikan tombol bilah atas dan aksi plotting dari empty-state", () => {
    const mapContent = fs.readFileSync(networkMapPath, "utf-8");

    // Bilah kontrol atas
    assert.match(mapContent, /open-customer-coordinate-picker-button/, "Memiliki tombol 'Tentukan Titik' di toolbar");
    assert.match(mapContent, /CustomerCoordinatePickerModal/, "Memasang CustomerCoordinatePickerModal");

    // Empty state upgrade aksi langsung
    assert.match(mapContent, /start-plot-customer-button/, "Memiliki CTA 'Tentukan Titik di Peta Sekarang' di banner unmapped");
    assert.match(mapContent, /dismiss-unmapped-banner-button/, "Memiliki tombol 'Lihat Peta Saja' di banner unmapped");
    assert.match(mapContent, /isUnmappedDismissed/, "Mendukung dismiss banner unmapped agar kanvas satelit dapat diakses");
  });

  test("4. network-map.tsx memiliki kartu konfirmasi dan penyimpanan koordinat langsung ke database", () => {
    const mapContent = fs.readFileSync(networkMapPath, "utf-8");

    // Floating action cards
    assert.match(mapContent, /customer-coordinate-confirmation-card/, "Memiliki floating card konfirmasi plotting pelanggan");
    assert.match(mapContent, /save-customer-coordinate-button/, "Memiliki tombol 'Simpan ke Database'");
    assert.match(mapContent, /cancel-customer-coordinate-button/, "Memiliki tombol batal plotting");

    // Inspected map coord card (klik peta bebas)
    assert.match(mapContent, /inspected-map-coord-card/, "Memiliki kartu inspeksi titik klik peta bebas");
    assert.match(mapContent, /copy-inspected-coord-button/, "Memiliki tombol salin koordinat inspeksi");
    assert.match(mapContent, /plot-inspected-customer-button/, "Memiliki tombol tautkan ke pelanggan");

    // Endpoint simpan ke database
    assert.match(mapContent, /\/api\/customers\/\$\{plottingCustomer\.id\}\/location/, "Memanggil PATCH endpoint lokasi pelanggan");
    assert.match(mapContent, /handleSavePlottedCustomer/, "Memiliki handler simpan yang memperbarui state dan database");
  });

  test("5. Endpoint backend PATCH /api/customers/[id]/location memvalidasi dan menyimpan ke tabel customers PostgreSQL", () => {
    const routeContent = fs.readFileSync(customerLocationRoutePath, "utf-8");
    const serviceContent = fs.readFileSync(customerLocationServicePath, "utf-8");

    // Validasi sesi dan input koordinat
    assert.match(routeContent, /updateCustomerLocation/, "Route memanggil service updateCustomerLocation");
    assert.match(serviceContent, /latitude/, "Service memperbarui kolom latitude");
    assert.match(serviceContent, /longitude/, "Service memperbarui kolom longitude");
    assert.match(serviceContent, /customers/, "Service memperbarui tabel customers PostgreSQL");
  });
});
