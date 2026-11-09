import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { updateInfrastructureLocationSchema } from "../src/validators/infrastructure-placement.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiItemRoutePath = path.resolve(
  __dirname,
  "../src/app/api/infrastructure/[id]/route.ts",
);
const apiItemLocationRoutePath = path.resolve(
  __dirname,
  "../src/app/api/infrastructure/[id]/location/route.ts",
);
const mapApiItemRoutePath = path.resolve(
  __dirname,
  "../src/app/api/map/infrastructure/[id]/route.ts",
);
const mapApiItemLocationRoutePath = path.resolve(
  __dirname,
  "../src/app/api/map/infrastructure/[id]/location/route.ts",
);
const apiRoutePath = path.resolve(
  __dirname,
  "../src/app/api/infrastructure/route.ts",
);
const servicePath = path.resolve(
  __dirname,
  "../src/services/map-infrastructure.service.ts",
);

test("Task: Buat endpoint perbarui posisi perangkat", async (t) => {
  const apiItemRouteContent = fs.readFileSync(apiItemRoutePath, "utf8");
  const apiItemLocationRouteContent = fs.readFileSync(
    apiItemLocationRoutePath,
    "utf8",
  );
  const mapApiItemRouteContent = fs.readFileSync(mapApiItemRoutePath, "utf8");
  const mapApiItemLocationRouteContent = fs.readFileSync(
    mapApiItemLocationRoutePath,
    "utf8",
  );
  const apiRouteContent = fs.readFileSync(apiRoutePath, "utf8");
  const serviceContent = fs.readFileSync(servicePath, "utf8");

  await t.test(
    "Validator: updateInfrastructureLocationSchema memvalidasi dan memproses koordinat secara fleksibel",
    () => {
      // 1. Format standar latitude & longitude
      const standardValid = updateInfrastructureLocationSchema.safeParse({
        latitude: -2.5786,
        longitude: 101.2185,
      });
      assert.equal(
        standardValid.success,
        true,
        "Koordinat standar harus diterima",
      );
      if (standardValid.success) {
        assert.equal(standardValid.data.latitude, -2.5786);
        assert.equal(standardValid.data.longitude, 101.2185);
      }

      // 2. Format singkatan lat & lng
      const shorthandValid = updateInfrastructureLocationSchema.safeParse({
        lat: -2.5786,
        lng: 101.2185,
      });
      assert.equal(
        shorthandValid.success,
        true,
        "Format singkatan lat/lng harus diproses dengan benar",
      );
      if (shorthandValid.success) {
        assert.equal(shorthandValid.data.latitude, -2.5786);
        assert.equal(shorthandValid.data.longitude, 101.2185);
      }

      // 3. String numeric coercion
      const stringValid = updateInfrastructureLocationSchema.safeParse({
        latitude: "-2.578611",
        longitude: "101.218544",
      });
      assert.equal(
        stringValid.success,
        true,
        "Koordinat berupa string numerik harus dikonversi",
      );
      if (stringValid.success) {
        assert.equal(stringValid.data.latitude, -2.578611);
        assert.equal(stringValid.data.longitude, 101.218544);
      }

      // 4. Penolakan koordinat di luar batas bumi
      const invalidLat = updateInfrastructureLocationSchema.safeParse({
        latitude: 91.5,
        longitude: 101.2,
      });
      assert.equal(
        invalidLat.success,
        false,
        "Latitude > 90 derajat harus ditolak",
      );

      const invalidLng = updateInfrastructureLocationSchema.safeParse({
        latitude: -2.5,
        longitude: 181.0,
      });
      assert.equal(
        invalidLng.success,
        false,
        "Longitude > 180 derajat harus ditolak",
      );
    },
  );

  await t.test(
    "Service: updateInfrastructureLocation menyimpan koordinat ke database dan mencatat audit log",
    () => {
      assert.match(
        serviceContent,
        /export async function updateInfrastructureLocation/,
        "Service wajib menyediakan fungsi updateInfrastructureLocation",
      );
      assert.match(
        serviceContent,
        /action: "move_infrastructure_point"/,
        "Service wajib mencatat aksi audit log move_infrastructure_point",
      );
      assert.match(
        serviceContent,
        /target: `infrastructure:\${id}`/,
        "Service wajib mencatat target audit log yang sesuai",
      );
    },
  );

  await t.test(
    "API Endpoint: /api/infrastructure/[id] menyediakan method PATCH dan PUT terautentikasi",
    () => {
      assert.match(
        apiItemRouteContent,
        /export async function PATCH/,
        "Handler PATCH wajib tersedia di /api/infrastructure/[id]",
      );
      assert.match(
        apiItemRouteContent,
        /export const PUT = PATCH/,
        "Handler PUT wajib dialiaskan ke PATCH di /api/infrastructure/[id]",
      );
      assert.match(
        apiItemRouteContent,
        /withApiSession\(request/,
        "Handler wajib terautentikasi withApiSession",
      );
    },
  );

  await t.test(
    "API Endpoint: /api/infrastructure/[id]/location menyediakan GET, PATCH, dan PUT lokasi khusus",
    () => {
      assert.match(
        apiItemLocationRouteContent,
        /export async function GET/,
        "Handler GET lokasi perangkat wajib tersedia",
      );
      assert.match(
        apiItemLocationRouteContent,
        /export async function PATCH/,
        "Handler PATCH lokasi perangkat wajib tersedia",
      );
      assert.match(
        apiItemLocationRouteContent,
        /export async function PUT/,
        "Handler PUT lokasi perangkat wajib tersedia",
      );
      assert.match(
        apiItemLocationRouteContent,
        /updateInfrastructureLocationSchema/,
        "Handler wajib memvalidasi koordinat menggunakan schema",
      );
    },
  );

  await t.test(
    "API Endpoint: /api/map/infrastructure/[id]/location dan /api/infrastructure rute konsisten",
    () => {
      assert.match(
        mapApiItemLocationRouteContent,
        /export async function PATCH/,
        "Map item location route wajib memiliki handler PATCH",
      );
      assert.match(
        apiRouteContent,
        /export async function PATCH/,
        "Root infrastructure route wajib memiliki handler PATCH",
      );
    },
  );
});
