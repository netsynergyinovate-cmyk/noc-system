import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createInfrastructurePointSchema,
  infrastructureDeviceTypes,
} from "../src/validators/infrastructure-placement.ts";

test("Fitur Pemilih Jenis Perangkat dan Penempatan Titik Infrastruktur", async (t) => {
  await t.test("Validator Zod: Validasi jenis perangkat dan koordinat penempatan", () => {
    // 5 jenis perangkat valid
    for (const type of infrastructureDeviceTypes) {
      const valid = createInfrastructurePointSchema.safeParse({
        name: `Perangkat ${type.toUpperCase()}`,
        type,
        latitude: -2.5786,
        longitude: 101.2185,
        host: "10.10.0.1",
      });
      assert.equal(valid.success, true, `Tipe ${type} harus valid`);
    }

    // Menolak tipe perangkat tidak dikenal
    const invalidType = createInfrastructurePointSchema.safeParse({
      name: "Perangkat Aneh",
      type: "unsupported_device",
      latitude: -2.5786,
      longitude: 101.2185,
    });
    assert.equal(invalidType.success, false);

    // Menolak nama kosong
    const emptyName = createInfrastructurePointSchema.safeParse({
      name: "   ",
      type: "odp",
      latitude: -2.5786,
      longitude: 101.2185,
    });
    assert.equal(emptyName.success, false);

    // Menolak koordinat di luar rentang
    const invalidLat = createInfrastructurePointSchema.safeParse({
      name: "ODP Sentral",
      type: "odp",
      latitude: -95,
      longitude: 101.2185,
    });
    assert.equal(invalidLat.success, false);
  });

  await t.test("API Endpoint: Memastikan rute API /api/map/infrastructure tersedia", () => {
    const routeFile = path.resolve("src/app/api/map/infrastructure/route.ts");
    assert.equal(fs.existsSync(routeFile), true, "File route API infrastruktur harus ada");
    const content = fs.readFileSync(routeFile, "utf-8");

    assert.match(content, /export const runtime = "nodejs"/);
    assert.match(content, /export async function GET/);
    assert.match(content, /export async function POST/);
    assert.match(content, /createInfrastructurePointSchema/);
    assert.match(content, /createInfrastructurePoint/);
  });

  await t.test("Service: Memastikan map-infrastructure.service terhubung ke PostgreSQL Drizzle", () => {
    const serviceFile = path.resolve("src/services/map-infrastructure.service.ts");
    assert.equal(fs.existsSync(serviceFile), true);
    const content = fs.readFileSync(serviceFile, "utf-8");

    assert.match(content, /import "server-only"/);
    assert.match(content, /export async function createInfrastructurePoint/);
    assert.match(content, /auditLog/);
    assert.match(content, /target: `infrastructure:\${input\.type}:\${generatedId}`/);
  });

  await t.test("DeviceTypePicker: Menyediakan 5 jenis perangkat dan form konfirmasi penempatan", () => {
    const pickerFile = path.resolve("src/components/map/device-type-picker.tsx");
    assert.equal(fs.existsSync(pickerFile), true);
    const content = fs.readFileSync(pickerFile, "utf-8");

    assert.match(content, /data-testid="device-type-picker"/);
    assert.match(content, /select-type-router/);
    assert.match(content, /select-type-olt/);
    assert.match(content, /select-type-odp/);
    assert.match(content, /select-type-odc/);
    assert.match(content, /select-type-pole/);

    assert.match(content, /data-testid="device-placement-form"/);
    assert.match(content, /data-testid="device-name-input"/);
    assert.match(content, /data-testid="device-lat-input"/);
    assert.match(content, /data-testid="device-lng-input"/);
    assert.match(content, /data-testid="confirm-place-device-button"/);
    assert.match(content, /data-testid="cancel-place-device-button"/);
  });

  await t.test("NetworkMap: Menyediakan kontrol penempatan dan marker draft penempatan", () => {
    const mapFile = path.resolve("src/components/map/network-map.tsx");
    assert.equal(fs.existsSync(mapFile), true);
    const content = fs.readFileSync(mapFile, "utf-8");

    assert.match(content, /data-testid="toggle-device-placement-button"/);
    assert.match(content, /data-testid="device-placement-banner"/);
    assert.match(content, /data-testid="draft-device-placement-marker"/);
    assert.match(content, /<DeviceTypePicker/);
    assert.match(content, /handleConfirmDevicePlacement/);
    assert.match(content, /onSelectPlacement/);
  });
});
