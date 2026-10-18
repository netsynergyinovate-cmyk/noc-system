import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { updateCustomerLocationSchema } from "../src/validators/customer-location.ts";
import { getTileProviders } from "../src/config/map.ts";

test("Fitur Geser dan Simpan Posisi Titik Pelanggan", async (t) => {
  await t.test("Validator Zod: Validasi koordinat latitude dan longitude pelanggan", () => {
    // Koordinat valid
    const validResult = updateCustomerLocationSchema.safeParse({
      latitude: -2.578612,
      longitude: 101.218544,
    });
    assert.equal(validResult.success, true);
    if (validResult.success) {
      assert.equal(validResult.data.latitude, -2.578612);
      assert.equal(validResult.data.longitude, 101.218544);
    }

    // Menolak latitude di luar rentang [-90, 90]
    const invalidLat = updateCustomerLocationSchema.safeParse({
      latitude: 91.5,
      longitude: 101.2,
    });
    assert.equal(invalidLat.success, false);

    // Menolak longitude di luar rentang [-180, 180]
    const invalidLng = updateCustomerLocationSchema.safeParse({
      latitude: -2.5,
      longitude: -185.0,
    });
    assert.equal(invalidLng.success, false);

    // Menolak tipe data bukan angka
    const invalidType = updateCustomerLocationSchema.safeParse({
      latitude: "invalid",
      longitude: 101.2,
    });
    assert.equal(invalidType.success, false);
  });

  await t.test("API Endpoint: Memastikan route handler location pelanggan lengkap", () => {
    const routeFile = path.resolve("src/app/api/customers/[id]/location/route.ts");
    assert.equal(fs.existsSync(routeFile), true, "File route location harus ada");
    const content = fs.readFileSync(routeFile, "utf-8");

    assert.match(content, /export const runtime = "nodejs"/);
    assert.match(content, /export async function GET/);
    assert.match(content, /export async function PATCH/);
    assert.match(content, /export async function PUT/);
    assert.match(content, /withApiSession/);
    assert.match(content, /updateCustomerLocationSchema/);
    assert.match(content, /updateCustomerLocation/);
  });

  await t.test("Service: Memastikan customer-location.service terhubung ke PostgreSQL Drizzle", () => {
    const serviceFile = path.resolve("src/services/customer-location.service.ts");
    assert.equal(fs.existsSync(serviceFile), true);
    const content = fs.readFileSync(serviceFile, "utf-8");

    assert.match(content, /import "server-only"/);
    assert.match(content, /export async function updateCustomerLocation/);
    assert.match(content, /export async function getCustomerCoordinates/);
    assert.match(content, /db\s*\.update\(\s*customers\s*\)/);
    assert.match(content, /auditLog/);
    assert.match(content, /target: `customer:\${customerId}`/);
  });

  await t.test("CustomerDetailPanel: Menyediakan tombol geser, kontainer mode geser, dan tombol simpan posisi", () => {
    const panelFile = path.resolve("src/components/map/customer-detail-panel.tsx");
    assert.equal(fs.existsSync(panelFile), true);
    const content = fs.readFileSync(panelFile, "utf-8");

    assert.match(content, /data-testid="edit-location-button"/);
    assert.match(content, /data-testid="edit-location-mode-container"/);
    assert.match(content, /data-testid="draft-coordinates-display"/);
    assert.match(content, /data-testid="save-location-button"/);
    assert.match(content, /data-testid="cancel-location-button"/);
    assert.match(content, /data-testid="location-save-success"/);
    assert.match(content, /data-testid="location-save-error"/);
  });

  await t.test("NetworkMap: Menyediakan MapLocationPicker, Draggable Marker, dan panduan geser", () => {
    const mapFile = path.resolve("src/components/map/network-map.tsx");
    assert.equal(fs.existsSync(mapFile), true);
    const content = fs.readFileSync(mapFile, "utf-8");

    assert.match(content, /function MapLocationPicker/);
    assert.match(content, /data-testid="draggable-customer-marker"/);
    assert.match(content, /data-testid="edit-location-guide-banner"/);
    assert.match(content, /data-testid="banner-save-location-button"/);
    assert.match(content, /draggable=\{true\}/);
    assert.match(content, /dragend/);
    assert.match(content, /\/api\/customers\/\$\{selectedCustomer\.id\}\/location/);
  });

  await t.test("Tile Provider: Memastikan seluruh layer memiliki properti subdomains yang aman", () => {
    const providers = getTileProviders();
    for (const [key, provider] of Object.entries(providers)) {
      assert.ok(
        Array.isArray(provider.subdomains) && provider.subdomains.length > 0,
        `Tile provider ${key} harus memiliki array subdomains valid`,
      );
    }
  });
});
