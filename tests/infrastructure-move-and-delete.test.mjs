import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  updateInfrastructureLocationSchema,
  deleteInfrastructurePointSchema,
} from "../src/validators/infrastructure-placement.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const networkMapPath = path.resolve(
  __dirname,
  "../src/components/map/network-map.tsx",
);
const layerPath = path.resolve(
  __dirname,
  "../src/components/map/map-detail-inspector-layer.tsx",
);
const detailPanelPath = path.resolve(
  __dirname,
  "../src/components/map/device-detail-panel.tsx",
);
const servicePath = path.resolve(
  __dirname,
  "../src/services/map-infrastructure.service.ts",
);
const apiRoutePath = path.resolve(
  __dirname,
  "../src/app/api/map/infrastructure/route.ts",
);
const apiItemRoutePath = path.resolve(
  __dirname,
  "../src/app/api/map/infrastructure/[id]/route.ts",
);

test("Fitur Pindah dan Hapus Perangkat Infrastruktur di Peta", async (t) => {
  const baseMapContent = fs.readFileSync(networkMapPath, "utf8");
  const layerContent = fs.existsSync(layerPath)
    ? fs.readFileSync(layerPath, "utf8")
    : "";
  const mapContent = baseMapContent + "\n" + layerContent;
  const panelContent = fs.readFileSync(detailPanelPath, "utf8");
  const serviceContent = fs.readFileSync(servicePath, "utf8");
  const apiRouteContent = fs.readFileSync(apiRoutePath, "utf8");
  const apiItemRouteContent = fs.readFileSync(apiItemRoutePath, "utf8");

  await t.test(
    "Validator Zod: Validasi koordinat perpindahan dan penghapusan perangkat",
    () => {
      // Validasi lokasi sukses
      const validLocation = updateInfrastructureLocationSchema.safeParse({
        latitude: -2.5786,
        longitude: 101.2185,
      });
      assert.equal(
        validLocation.success,
        true,
        "Koordinat valid harus diterima",
      );

      // Validasi lokasi gagal jika di luar rentang geografis
      const invalidLat = updateInfrastructureLocationSchema.safeParse({
        latitude: 105.0,
        longitude: 101.2185,
      });
      assert.equal(invalidLat.success, false, "Latitude > 90 harus ditolak");

      const invalidLng = updateInfrastructureLocationSchema.safeParse({
        latitude: -2.5786,
        longitude: 200.0,
      });
      assert.equal(invalidLng.success, false, "Longitude > 180 harus ditolak");

      // Validasi penghapusan
      const validDelete = deleteInfrastructurePointSchema.safeParse({
        id: "odp-test-123",
      });
      assert.equal(validDelete.success, true);

      const emptyDelete = deleteInfrastructurePointSchema.safeParse({
        id: "   ",
      });
      assert.equal(emptyDelete.success, false, "ID kosong harus ditolak");
    },
  );

  await t.test(
    "Service: Memastikan fungsi updateInfrastructureLocation dan deleteInfrastructurePoint tersedia",
    () => {
      assert.match(
        serviceContent,
        /export async function updateInfrastructureLocation/,
        "Service harus mengekspor fungsi updateInfrastructureLocation",
      );
      assert.match(
        serviceContent,
        /export async function deleteInfrastructurePoint/,
        "Service harus mengekspor fungsi deleteInfrastructurePoint",
      );
      assert.match(
        serviceContent,
        /action: "move_infrastructure_point"/,
        "Service harus mencatat audit log move_infrastructure_point",
      );
      assert.match(
        serviceContent,
        /action: "delete_infrastructure_point"/,
        "Service harus mencatat audit log delete_infrastructure_point",
      );
    },
  );

  await t.test(
    "API Endpoints: Menyediakan method PATCH dan DELETE lengkap",
    () => {
      assert.match(
        apiRouteContent,
        /export async function PATCH/,
        "Rute /api/map/infrastructure harus mengekspor handler PATCH",
      );
      assert.match(
        apiRouteContent,
        /export async function DELETE/,
        "Rute /api/map/infrastructure harus mengekspor handler DELETE",
      );
      assert.match(
        apiItemRouteContent,
        /export async function PATCH/,
        "Rute /api/map/infrastructure/[id] harus mengekspor handler PATCH",
      );
      assert.match(
        apiItemRouteContent,
        /export async function DELETE/,
        "Rute /api/map/infrastructure/[id] harus mengekspor handler DELETE",
      );
    },
  );

  await t.test(
    "DeviceDetailPanel: Menyediakan tombol Pindah Lokasi dan Hapus Titik",
    () => {
      assert.match(
        panelContent,
        /data-testid="move-infra-button"/,
        "Panel harus memiliki tombol 'Pindah Lokasi' dengan data-testid='move-infra-button'",
      );
      assert.match(
        panelContent,
        /data-testid="delete-infra-button"/,
        "Panel harus memiliki tombol 'Hapus Titik' dengan data-testid='delete-infra-button'",
      );
    },
  );

  await t.test(
    "DeviceDetailPanel: Kontrol mode pindah aktif dan dialog konfirmasi hapus",
    () => {
      assert.match(
        panelContent,
        /data-testid="infra-move-controls"/,
        "Panel harus memiliki kontainer kontrol mode geser infra",
      );
      assert.match(
        panelContent,
        /data-testid="infra-draft-coords"/,
        "Panel harus menampilkan koordinat baru hasil geseran",
      );
      assert.match(
        panelContent,
        /data-testid="cancel-move-infra-button"/,
        "Panel harus memiliki tombol batal pindah posisi",
      );
      assert.match(
        panelContent,
        /data-testid="save-infra-location-button"/,
        "Panel harus memiliki tombol simpan posisi baru",
      );
      assert.match(
        panelContent,
        /data-testid="delete-infra-confirm-dialog"/,
        "Panel harus memiliki dialog konfirmasi hapus",
      );
      assert.match(
        panelContent,
        /data-testid="cancel-delete-infra-button"/,
        "Panel harus memiliki tombol batal hapus",
      );
      assert.match(
        panelContent,
        /data-testid="confirm-delete-infra-button"/,
        "Panel harus memiliki tombol konfirmasi ya hapus",
      );
    },
  );

  await t.test(
    "NetworkMap: Mengintegrasikan interaksi peta, Draggable Marker, dan notifikasi",
    () => {
      assert.match(
        mapContent,
        /data-testid="draggable-infra-marker"/,
        "Peta harus memiliki draggable marker untuk pergeseran titik perangkat",
      );
      assert.match(
        mapContent,
        /handleStartMoveInfra/,
        "NetworkMap harus menangani permulaan mode pindah perangkat",
      );
      assert.match(
        mapContent,
        /handleSaveMoveInfra/,
        "NetworkMap harus menangani simpan posisi perangkat ke API",
      );
      assert.match(
        mapContent,
        /handleDeleteInfra/,
        "NetworkMap harus menangani penghapusan perangkat via API",
      );
      assert.match(
        mapContent,
        /data-testid="infra-action-success-message"/,
        "Peta harus menampilkan banner notifikasi aksi sukses",
      );
    },
  );
});
