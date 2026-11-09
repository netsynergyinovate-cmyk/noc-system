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
const markersServicePath = path.resolve(
  __dirname,
  "../src/services/map-markers.service.ts",
);

test("Tambah pencarian nama dan nomor pelanggan", async (t) => {
  const mapContent = fs.readFileSync(networkMapPath, "utf8");
  const hookContent = fs.readFileSync(hookPath, "utf8");
  const serviceContent = fs.readFileSync(markersServicePath, "utf8");

  await t.test(
    "Input pencarian peta mendukung placeholder dan atribut nama & nomor pelanggan",
    () => {
      assert.match(
        mapContent,
        /data-testid="map-search-input"/,
        "Input pencarian harus memiliki data-testid='map-search-input'",
      );
      assert.match(
        mapContent,
        /placeholder="Cari nama atau nomor pelanggan\.\.\."/,
        "Placeholder input harus jelas mengindikasikan pencarian nama atau nomor pelanggan",
      );
      assert.match(
        mapContent,
        /aria-label="Cari nama atau nomor pelanggan"/,
        "Input pencarian harus memiliki label aksesibilitas aria-label",
      );
    },
  );

  await t.test(
    "Filter peta mencakup nama, username PPPoE, ID pelanggan, dan nomor seri ONU",
    () => {
      assert.match(
        mapContent,
        /const matchesName = c\.name\.toLowerCase\(\)\.includes\(query\)/,
        "Filter harus mencocokkan nama pelanggan",
      );
      assert.match(
        mapContent,
        /const matchesUsername = c\.pppoeUsername\.toLowerCase\(\)\.includes\(query\)/,
        "Filter harus mencocokkan nomor akun / username PPPoE",
      );
      assert.match(
        mapContent,
        /const matchesId = c\.id\.toLowerCase\(\)\.includes\(query\)/,
        "Filter harus mencocokkan ID/nomor unik pelanggan",
      );
      assert.match(
        mapContent,
        /c\.onuDetails\?\.serialNumber\?\.toLowerCase\(\)\.includes\(query\)/,
        "Filter harus mencocokkan nomor seri modem ONT/ONU",
      );
    },
  );

  await t.test(
    "Dropdown saran hasil pencarian cepat merender nama dan nomor pelanggan",
    () => {
      assert.match(
        mapContent,
        /data-testid="search-results-dropdown"/,
        "Harus ada dropdown hasil pencarian dengan data-testid='search-results-dropdown'",
      );
      assert.match(
        mapContent,
        /data-testid="search-result-item"/,
        "Item hasil pencarian harus memiliki data-testid='search-result-item'",
      );
      assert.match(
        mapContent,
        /data-testid="search-result-number"/,
        "Harus menampilkan nomor/username pelanggan pada hasil pencarian",
      );
      assert.match(
        mapContent,
        /data-testid="search-no-results"/,
        "Harus ada state saat tidak ada hasil pencarian",
      );
    },
  );

  await t.test(
    "Hook useNetworkMapMarkers mendukung filter nama dan nomor pelanggan",
    () => {
      assert.match(
        hookContent,
        /c\.pppoeUsername\.toLowerCase\(\)\.includes\(q\)/,
        "Hook filter harus mencakup username/nomor pelanggan",
      );
      assert.match(
        hookContent,
        /c\.id\.toLowerCase\(\)\.includes\(q\)/,
        "Hook filter harus mencakup ID pelanggan",
      );
      assert.match(
        hookContent,
        /c\.onuDetails\?\.serialNumber\?\.toLowerCase\(\)\.includes\(q\)/,
        "Hook filter harus mencakup nomor seri modem ONU",
      );
    },
  );

  await t.test(
    "Service map-markers mendukung pencarian nama, nomor/pppoe, dan nomor seri",
    () => {
      assert.match(
        serviceContent,
        /matchName\s*\|\|\s*matchId\s*\|\|\s*matchOdp\s*\|\|\s*matchHost\s*\|\|\s*matchAddr\s*\|\|\s*matchPppoe\s*\|\|\s*matchSerial/,
        "Service markers harus memfilter berdasarkan nama, ID, nomor PPPoE, dan serial number",
      );
    },
  );
});
