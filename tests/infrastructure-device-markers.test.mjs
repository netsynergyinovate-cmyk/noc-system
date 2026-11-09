import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INFRASTRUCTURE_DEVICE_CONFIG,
  getInfrastructureDeviceStyle,
} from "../src/config/map-infrastructure.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const networkMapPath = path.resolve(
  __dirname,
  "../src/components/map/network-map.tsx",
);
const legendPath = path.resolve(
  __dirname,
  "../src/components/map/network-map-legend.tsx",
);
const typePickerPath = path.resolve(
  __dirname,
  "../src/components/map/device-type-picker.tsx",
);
const detailPanelPath = path.resolve(
  __dirname,
  "../src/components/map/device-detail-panel.tsx",
);

test("Terapkan ikon dan warna berbeda tiap jenis infrastruktur", async (t) => {
  const baseMapContent = fs.readFileSync(networkMapPath, "utf8");
  const legendContent = fs.existsSync(legendPath)
    ? fs.readFileSync(legendPath, "utf8")
    : "";
  const mapContent = baseMapContent + "\n" + legendContent;
  const pickerContent = fs.readFileSync(typePickerPath, "utf8");
  const panelContent = fs.readFileSync(detailPanelPath, "utf8");

  await t.test(
    "Konfigurasi standar 5 jenis perangkat memiliki warna dan ikon unik",
    () => {
      const types = ["router", "olt", "odc", "odp", "pole"];
      const colors = new Set();
      const svgs = new Set();

      for (const type of types) {
        const config = INFRASTRUCTURE_DEVICE_CONFIG[type];
        assert.ok(config, `Konfigurasi untuk ${type} harus tersedia`);
        assert.ok(config.color, `Warna untuk ${type} harus ditentukan`);
        assert.ok(config.iconSvg, `SVG ikon untuk ${type} harus ditentukan`);
        assert.ok(
          !colors.has(config.color),
          `Warna untuk ${type} (${config.color}) harus unik`,
        );
        assert.ok(
          !svgs.has(config.iconSvg),
          `SVG ikon untuk ${type} harus unik`,
        );
        colors.add(config.color);
        svgs.add(config.iconSvg);
      }

      assert.equal(
        colors.size,
        5,
        "Harus ada 5 warna berbeda untuk 5 jenis infrastruktur",
      );
      assert.equal(
        svgs.size,
        5,
        "Harus ada 5 ikon berbeda untuk 5 jenis infrastruktur",
      );
    },
  );

  await t.test(
    "Helper getInfrastructureDeviceStyle memberikan konfigurasi dan fallback yang aman",
    () => {
      const routerStyle = getInfrastructureDeviceStyle("router");
      assert.equal(routerStyle.type, "router");
      assert.equal(routerStyle.color, "#8b5cf6");

      const oltStyle = getInfrastructureDeviceStyle("OLT");
      assert.equal(oltStyle.type, "olt");
      assert.equal(oltStyle.color, "#06b6d4");

      const fallbackStyle = getInfrastructureDeviceStyle("unknown_device");
      assert.equal(fallbackStyle.type, "pole");
    },
  );

  await t.test(
    "NetworkMap menerapkan warna spesifik untuk 5 jenis infrastruktur",
    () => {
      assert.match(
        mapContent,
        /isRouter[\s\S]*?#8b5cf6[\s\S]*?isOlt[\s\S]*?#06b6d4[\s\S]*?isOdc[\s\S]*?#3b82f6[\s\S]*?isOdp[\s\S]*?#f59e0b[\s\S]*?#64748b/,
        "Peta harus menerapkan 5 warna berbeda untuk router, olt, odc, odp, dan pole",
      );
    },
  );

  await t.test(
    "NetworkMap merender Tooltip dengan label dan ikon khusus tiap jenis",
    () => {
      assert.match(
        mapContent,
        /Router Gateway:/,
        "Tooltip memuat label Router",
      );
      assert.match(mapContent, /OLT Fiber:/, "Tooltip memuat label OLT");
      assert.match(
        mapContent,
        /ODC Sentral Feeder:/,
        "Tooltip memuat label ODC",
      );
      assert.match(mapContent, /ODP Kotak:/, "Tooltip memuat label ODP");
      assert.match(mapContent, /Tiang Fiber:/, "Tooltip memuat label Tiang");
    },
  );

  await t.test(
    "NetworkMap menginisialisasi DivIcon tajam untuk penanda perangkat",
    () => {
      assert.match(
        mapContent,
        /INFRASTRUCTURE_DEVICE_CONFIG/,
        "network-map.tsx harus mengimpor INFRASTRUCTURE_DEVICE_CONFIG",
      );
      assert.match(
        mapContent,
        /custom-infra-icon/,
        "network-map.tsx harus membuat custom-infra-icon DivIcon",
      );
      assert.match(
        mapContent,
        /infraIcons\[infra\.type\]/,
        "network-map.tsx harus merender ikon vektor di atas titik perangkat",
      );
    },
  );

  await t.test(
    "Legenda peta menampilkan simbol dan warna untuk seluruh 5 jenis infrastruktur",
    () => {
      assert.match(
        mapContent,
        /data-testid="infra-legend-router"/,
        "Legenda memuat Router",
      );
      assert.match(
        mapContent,
        /data-testid="infra-legend-olt"/,
        "Legenda memuat OLT",
      );
      assert.match(
        mapContent,
        /data-testid="infra-legend-odc"/,
        "Legenda memuat ODC",
      );
      assert.match(
        mapContent,
        /data-testid="infra-legend-odp"/,
        "Legenda memuat ODP",
      );
      assert.match(
        mapContent,
        /data-testid="infra-legend-pole"/,
        "Legenda memuat Tiang",
      );
    },
  );

  await t.test(
    "Konsistensi warna visual di seluruh komponen (Picker, Panel, Map)",
    () => {
      const types = ["router", "olt", "odc", "odp", "pole"];
      for (const t of types) {
        const cfg = INFRASTRUCTURE_DEVICE_CONFIG[t];
        assert.ok(
          pickerContent.includes(cfg.color),
          `DeviceTypePicker harus memuat warna ${cfg.color} untuk ${t}`,
        );
        assert.ok(
          panelContent.includes(cfg.color),
          `DeviceDetailPanel harus memuat warna ${cfg.color} untuk ${t}`,
        );
        assert.ok(
          mapContent.includes(cfg.color),
          `NetworkMap harus memuat warna ${cfg.color} untuk ${t}`,
        );
      }
    },
  );
});
