import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const networkMapPath = path.resolve(
  __dirname,
  "../src/components/map/network-map.tsx",
);
const hookPath = path.resolve(
  __dirname,
  "../src/hooks/use-network-map-markers.ts",
);

test("Tambah saringan wilayah dan status titik", async (t) => {
  const mapContent = fs.readFileSync(networkMapPath, "utf8");
  const hookContent = fs.readFileSync(hookPath, "utf8");

  await t.test(
    "Peta memiliki kontrol saringan wilayah (region/ODP filter)",
    () => {
      assert.match(
        mapContent,
        /data-testid="map-region-filter"/,
        "Peta harus memiliki select dropdown dengan data-testid='map-region-filter'",
      );
      assert.match(
        mapContent,
        /aria-label="Saring berdasarkan wilayah atau ODP"/,
        "Dropdown saringan wilayah harus memiliki aria-label",
      );
      assert.match(
        mapContent,
        /<option value="all">Semua Wilayah<\/option>/,
        "Dropdown saringan wilayah harus memiliki opsi default 'Semua Wilayah'",
      );
    },
  );

  await t.test(
    "Peta menghimpun daftar wilayah & ODP secara dinamis dari data",
    () => {
      assert.match(
        mapContent,
        /const availableRegions = useMemo/,
        "Peta harus menghitung availableRegions secara dinamis",
      );
      assert.match(
        mapContent,
        /availableRegions\.map/,
        "Peta harus merender opsi wilayah dari availableRegions",
      );
    },
  );

  await t.test("Peta memiliki kontrol saringan status titik lengkap", () => {
    assert.match(
      mapContent,
      /data-testid="map-status-filter"/,
      "Peta harus memiliki select dropdown dengan data-testid='map-status-filter'",
    );
    assert.match(
      mapContent,
      /<option value="all">Semua Status Titik<\/option>/,
      "Saringan status harus memiliki opsi default 'Semua Status Titik'",
    );
    assert.match(
      mapContent,
      /<option value="online">Titik Online<\/option>/,
      "Saringan status harus memiliki opsi 'Titik Online'",
    );
    assert.match(
      mapContent,
      /<option value="offline">Titik Offline<\/option>/,
      "Saringan status harus memiliki opsi 'Titik Offline'",
    );
    assert.match(
      mapContent,
      /<option value="weak">Redaman Kritis/,
      "Saringan status harus memiliki opsi 'Redaman Kritis'",
    );
    assert.match(
      mapContent,
      /<option value="isolir">Titik Terisolir<\/option>/,
      "Saringan status harus memiliki opsi 'Titik Terisolir'",
    );
    assert.match(
      mapContent,
      /<option value="geocoded">Hanya Titik GPS<\/option>/,
      "Saringan status harus memiliki opsi 'Hanya Titik GPS'",
    );
  });

  await t.test(
    "Logika filtering peta memproses saringan wilayah dan status titik",
    () => {
      assert.match(
        mapContent,
        /regionFilter !== "all" && c\.odpName !== regionFilter/,
        "Logika filter harus mengecualikan titik yang tidak sesuai regionFilter",
      );
      assert.match(
        mapContent,
        /statusFilter === "isolir" && c\.billingStatus !== "isolir"/,
        "Logika filter harus mengecualikan titik bukan isolir saat filter isolir aktif",
      );
      assert.match(
        mapContent,
        /statusFilter === "geocoded"/,
        "Logika filter harus memverifikasi titik koordinat GPS sah saat filter geocoded aktif",
      );
    },
  );

  await t.test(
    "Hook useNetworkMapMarkers mengekspor PointStatusFilter dan mendukung regionFilter",
    () => {
      assert.match(
        hookContent,
        /export type PointStatusFilter =/,
        "Hook harus mengekspor PointStatusFilter",
      );
      assert.match(
        hookContent,
        /regionFilter: string = "all"/,
        "Method filterMarkers harus menerima parameter regionFilter",
      );
      assert.match(
        hookContent,
        /statusFilter === "isolir"/,
        "filterMarkers harus menangani status isolir",
      );
      assert.match(
        hookContent,
        /statusFilter === "geocoded"/,
        "filterMarkers harus menangani status geocoded",
      );
      assert.match(
        hookContent,
        /regionFilter && regionFilter !== "all"/,
        "filterMarkers harus menyaring pelanggan sesuai regionFilter",
      );
    },
  );
});
