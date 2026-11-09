import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const panelPath = path.resolve(
  __dirname,
  "../src/components/map/customer-detail-panel.tsx",
);
const networkMapPath = path.resolve(
  __dirname,
  "../src/components/map/network-map.tsx",
);
const layerPath = path.resolve(
  __dirname,
  "../src/components/map/map-detail-inspector-layer.tsx",
);

test("Panel Detail Pelanggan di Atas Peta", async (t) => {
  const panelContent = fs.readFileSync(panelPath, "utf8");
  const mapContent = fs.readFileSync(networkMapPath, "utf8");
  const layerContent = fs.existsSync(layerPath)
    ? fs.readFileSync(layerPath, "utf8")
    : "";
  const combinedMapContent = mapContent + "\n" + layerContent;

  await t.test(
    "Komponen CustomerDetailPanel diekspor dan memiliki kontainer data-testid",
    () => {
      assert.match(
        panelContent,
        /export function CustomerDetailPanel/,
        "CustomerDetailPanel harus diekspor sebagai fungsi komponen",
      );
      assert.match(
        panelContent,
        /data-testid="customer-detail-panel"/,
        "Kontainer panel harus memiliki data-testid='customer-detail-panel'",
      );
    },
  );

  await t.test("Menampilkan nama pelanggan dan PPPoE username", () => {
    assert.match(
      panelContent,
      /data-testid="customer-name"/,
      "Panel harus menampilkan nama pelanggan dengan data-testid='customer-name'",
    );
    assert.match(
      panelContent,
      /data-testid="customer-pppoe"/,
      "Panel harus menampilkan pppoe username dengan data-testid='customer-pppoe'",
    );
  });

  await t.test("Menampilkan badge status koneksi Online dan Offline", () => {
    assert.match(
      panelContent,
      /data-testid="customer-status-badge"/,
      "Panel harus memiliki badge status koneksi",
    );
    assert.match(
      panelContent,
      /customer\.isOnline \?/,
      "Badge status harus membedakan kondisi isOnline",
    );
  });

  await t.test(
    "Menampilkan badge status tagihan billing Lunas vs Isolir",
    () => {
      assert.match(
        panelContent,
        /data-testid="customer-billing-badge"/,
        "Panel harus memiliki badge status billing",
      );
      assert.match(
        panelContent,
        /customer\.billingStatus === "lunas" \? "Lunas" : "Isolir"/,
        "Status billing harus membedakan Lunas dan Isolir",
      );
    },
  );

  await t.test(
    "Menampilkan redaman optik dengan klasifikasi ambang kritis/waspada/normal",
    () => {
      assert.match(
        panelContent,
        /data-testid="customer-optical-power"/,
        "Panel harus menampilkan redaman optik dengan data-testid='customer-optical-power'",
      );
      assert.match(
        panelContent,
        /data-testid="customer-optic-status-badge"/,
        "Panel harus memiliki badge klasifikasi level optik",
      );
      assert.match(
        panelContent,
        /customer\.opticalPower <= -24\.5/,
        "Ambang batas optik kritis harus <= -24.5 dBm",
      );
    },
  );

  await t.test(
    "Menampilkan ODP distribusi, router gateway, dan koordinat fisik",
    () => {
      assert.match(
        panelContent,
        /data-testid="customer-odp"/,
        "Panel harus menampilkan ODP distribusi",
      );
      assert.match(
        panelContent,
        /data-testid="customer-router"/,
        "Panel harus menampilkan router gateway",
      );
      assert.match(
        panelContent,
        /data-testid="customer-coordinates"/,
        "Panel harus menampilkan koordinat fisik",
      );
    },
  );

  await t.test(
    "Menampilkan rincian hardware ONU (serial number dan PON interface)",
    () => {
      assert.match(
        panelContent,
        /data-testid="customer-onu-section"/,
        "Panel harus memiliki seksi informasi ONU",
      );
      assert.match(
        panelContent,
        /data-testid="customer-onu-sn"/,
        "Panel harus menampilkan serial number ONU",
      );
      assert.match(
        panelContent,
        /data-testid="customer-onu-port"/,
        "Panel harus menampilkan PON port dan ONU index",
      );
    },
  );

  await t.test(
    "Menyediakan tombol aksi: Pusatkan, Salin GPS, Rute Maps, dan Link Data",
    () => {
      assert.match(
        panelContent,
        /data-testid="focus-customer-button"/,
        "Harus ada tombol pusatkan kamera peta",
      );
      assert.match(
        panelContent,
        /data-testid="copy-coordinates-button"/,
        "Harus ada tombol salin koordinat GPS",
      );
      assert.match(
        panelContent,
        /data-testid="open-gmaps-button"/,
        "Harus ada tombol buka rute navigasi Google Maps",
      );
      assert.match(
        panelContent,
        /data-testid="view-customer-link"/,
        "Harus ada link menuju detail data pelanggan",
      );
      assert.match(
        panelContent,
        /data-testid="close-customer-panel"/,
        "Harus ada tombol tutup panel detail",
      );
    },
  );

  await t.test(
    "Peta network-map.tsx merender CustomerDetailPanel di atas peta",
    () => {
      assert.match(
        combinedMapContent,
        /<CustomerDetailPanel/,
        "NetworkMap harus merender CustomerDetailPanel",
      );
      assert.match(
        combinedMapContent,
        /customer=\{selectedCustomer\}/,
        "NetworkMap harus mengoper selectedCustomer ke CustomerDetailPanel",
      );
    },
  );
});
