import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const panelPath = path.resolve(
  __dirname,
  "../src/components/map/device-detail-panel.tsx",
);
const networkMapPath = path.resolve(
  __dirname,
  "../src/components/map/network-map.tsx",
);
const layerPath = path.resolve(
  __dirname,
  "../src/components/map/map-detail-inspector-layer.tsx",
);

test("Panel Detail Perangkat Infrastruktur Peta (Data Nyata)", async (t) => {
  const panelContent = fs.readFileSync(panelPath, "utf8");
  const mapContent = fs.readFileSync(networkMapPath, "utf8");
  const layerContent = fs.existsSync(layerPath)
    ? fs.readFileSync(layerPath, "utf8")
    : "";
  const combinedMapContent = mapContent + "\n" + layerContent;

  await t.test(
    "Komponen DeviceDetailPanel diekspor dan memiliki kontainer data-testid='infra-detail-panel'",
    () => {
      assert.match(
        panelContent,
        /export function DeviceDetailPanel/,
        "DeviceDetailPanel harus diekspor sebagai fungsi komponen",
      );
      assert.match(
        panelContent,
        /data-testid="infra-detail-panel"/,
        "Kontainer panel harus memiliki data-testid='infra-detail-panel'",
      );
    },
  );

  await t.test(
    "Menampilkan badge tipe perangkat dan status aktif/nonaktif",
    () => {
      assert.match(
        panelContent,
        /data-testid="device-type-badge"/,
        "Panel harus menampilkan badge tipe perangkat dengan data-testid='device-type-badge'",
      );
      assert.match(
        panelContent,
        /data-testid="device-status-badge"/,
        "Panel harus menampilkan badge status dengan data-testid='device-status-badge'",
      );
      assert.match(
        panelContent,
        /device\.type/,
        "Badge jenis harus membaca field device.type",
      );
    },
  );

  await t.test("Menampilkan nama perangkat, host, dan koordinat GPS", () => {
    assert.match(
      panelContent,
      /data-testid="device-name"/,
      "Panel harus menampilkan nama perangkat",
    );
    assert.match(
      panelContent,
      /data-testid="device-host"/,
      "Panel harus menampilkan host perangkat jika tersedia",
    );
    assert.match(
      panelContent,
      /data-testid="device-coordinates"/,
      "Panel harus menampilkan koordinat GPS dengan data-testid='device-coordinates'",
    );
  });

  await t.test(
    "Menyediakan tombol aksi: pusatkan peta, salin koordinat, rute Google Maps, dan tutup panel",
    () => {
      assert.match(
        panelContent,
        /data-testid="focus-infra-button"/,
        "Harus ada tombol pusatkan peta ke titik perangkat",
      );
      assert.match(
        panelContent,
        /data-testid="copy-device-coordinates-button"/,
        "Harus ada tombol salin koordinat GPS ke clipboard",
      );
      assert.match(
        panelContent,
        /data-testid="open-device-gmaps-button"/,
        "Harus ada tombol navigasi rute Google Maps",
      );
      assert.match(
        panelContent,
        /data-testid="close-infra-panel"/,
        "Harus ada tombol tutup panel perangkat",
      );
    },
  );

  await t.test(
    "Menghitung data pelanggan terhubung secara nyata untuk ODP dari daftar pelanggan",
    () => {
      assert.match(
        panelContent,
        /data-testid="odp-connected-customers"/,
        "Harus ada counter jumlah pelanggan yang terhubung ke ODP",
      );
      assert.match(
        panelContent,
        /c\.odpName\.toLowerCase\(\)\s*===\s*device\.name\.toLowerCase\(\)/,
        "Harus mencocokkan pelanggan berdasarkan ODP name secara case-insensitive",
      );
      assert.match(
        panelContent,
        /data-testid="odp-customer-list-section"/,
        "Harus ada daftar nama dan status pelanggan terhubung",
      );
    },
  );

  await t.test(
    "Menyediakan pintasan navigasi operasional sesuai tipe perangkat",
    () => {
      assert.match(
        panelContent,
        /data-testid="shortcut-manage-router"/,
        "Harus ada pintasan kelola router MikroTik",
      );
      assert.match(
        panelContent,
        /data-testid="shortcut-manage-olt"/,
        "Harus ada pintasan kelola OLT & optik PON",
      );
      assert.match(
        panelContent,
        /data-testid="shortcut-odp-customers"/,
        "Harus ada pintasan ke daftar pelanggan ODP",
      );
      assert.match(
        panelContent,
        /data-testid="shortcut-odp-cpe"/,
        "Harus ada pintasan ke data CPE/OLT",
      );
    },
  );

  await t.test("Terintegrasi dengan komponen NetworkMap utama", () => {
    assert.match(
      mapContent,
      /import\s*\{\s*DeviceDetailPanel\s*\}\s*from\s*["']\.\/device-detail-panel["']/,
      "network-map.tsx harus mengimpor DeviceDetailPanel",
    );
    assert.match(
      combinedMapContent,
      /<DeviceDetailPanel[\s\S]*?device=\{selectedInfra\}[\s\S]*?\/>/,
      "network-map.tsx harus merender DeviceDetailPanel saat selectedInfra ada",
    );
  });
});
