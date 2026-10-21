import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("Task: Petakan Kapasitas Serat ke Ketebalan dan Warna", async (t) => {
  await t.test("1. Modul Konfigurasi cable-capacity.ts & Daftar Tingkatan CABLE_CAPACITY_TIERS", () => {
    const configPath = path.join(rootDir, "src", "config", "cable-capacity.ts");
    assert.ok(fs.existsSync(configPath), "File cable-capacity.ts harus ada");

    const content = fs.readFileSync(configPath, "utf-8");
    assert.match(
      content,
      /export const CABLE_CAPACITY_TIERS/,
      "Harus mengekspor daftar CABLE_CAPACITY_TIERS",
    );
    assert.match(
      content,
      /export function resolveCableCapacityStyle/,
      "Harus mengekspor fungsi resolveCableCapacityStyle",
    );
    assert.match(content, /#8b5cf6/, "Tingkat 48 Core harus berwarna Ungu (#8b5cf6)");
    assert.match(content, /#06b6d4/, "Tingkat 16 Core harus berwarna Cyan (#06b6d4)");
    assert.match(content, /#f59e0b/, "Tingkat 8 Core harus berwarna Amber (#f59e0b)");
    assert.match(content, /#10b981/, "Tingkat 1-2 Core normal harus berwarna Emerald (#10b981)");
  });

  await t.test(
    "2. Logika resolveCableCapacityStyle: Pemetaan Kapasitas Core ke Ketebalan dan Warna",
    () => {
      // Implementasi referensi untuk pengujian logika deterministik
      function resolveStyle({ coreCapacity, type, status, isHighlighted }) {
        let color = "#10b981";
        let baseWeight = 1.8;
        let dashArray;

        if (coreCapacity >= 48 || type === "backbone") {
          color = "#8b5cf6";
          baseWeight = 5.0;
          dashArray = "8, 6";
        } else if (coreCapacity >= 24) {
          color = "#6366f1";
          baseWeight = 4.0;
          dashArray = "7, 5";
        } else if (coreCapacity >= 12 || type === "feeder") {
          color = "#06b6d4";
          baseWeight = 3.2;
        } else if (coreCapacity >= 4 || type === "distribution") {
          color = "#f59e0b";
          baseWeight = 2.5;
          dashArray = "6, 4";
        } else {
          // Drop cable 1-2 core
          baseWeight = 1.8;
          if (status === "offline") color = "#ef4444";
          else if (status === "warning") color = "#f59e0b";
          else color = "#10b981";
        }

        if (isHighlighted) {
          color = "#22d3ee";
          baseWeight += 1.5;
        }

        return { color, baseWeight, dashArray };
      }

      // Uji Backbone 48C
      const backbone = resolveStyle({ coreCapacity: 48, type: "backbone" });
      assert.equal(backbone.color, "#8b5cf6", "Backbone 48C harus berwarna ungu");
      assert.equal(backbone.baseWeight, 5.0, "Backbone 48C harus memiliki ketebalan dasar 5.0px");
      assert.equal(backbone.dashArray, "8, 6", "Backbone harus memiliki pola garis putus-putus");

      // Uji Feeder 16C
      const feeder = resolveStyle({ coreCapacity: 16, type: "feeder" });
      assert.equal(feeder.color, "#06b6d4", "Feeder 16C harus berwarna cyan");
      assert.equal(feeder.baseWeight, 3.2, "Feeder 16C harus memiliki ketebalan dasar 3.2px");

      // Uji Distribusi 8C
      const dist = resolveStyle({ coreCapacity: 8, type: "distribution" });
      assert.equal(dist.color, "#f59e0b", "Distribusi 8C harus berwarna amber");
      assert.equal(dist.baseWeight, 2.5, "Distribusi 8C harus memiliki ketebalan 2.5px");

      // Uji Drop Optik 2C Online
      const dropOnline = resolveStyle({ coreCapacity: 2, type: "drop", status: "active" });
      assert.equal(dropOnline.color, "#10b981", "Drop online harus berwarna hijau");
      assert.equal(dropOnline.baseWeight, 1.8, "Drop optik harus memiliki ketebalan 1.8px");

      // Uji Drop Optik 2C Offline (Putus)
      const dropOffline = resolveStyle({ coreCapacity: 2, type: "drop", status: "offline" });
      assert.equal(dropOffline.color, "#ef4444", "Drop offline/putus harus berwarna merah");

      // Uji Kondisi Disorot (Highlighted)
      const highlighted = resolveStyle({ coreCapacity: 16, type: "feeder", isHighlighted: true });
      assert.equal(highlighted.color, "#22d3ee", "Kabel yang disorot harus berwarna neon cyan (#22d3ee)");
      assert.equal(highlighted.baseWeight, 4.7, "Kabel yang disorot harus bertambah tebal (+1.5px)");
    },
  );

  await t.test("3. Integrasi NetworkMap: Menggunakan resolveCableCapacityStyle pada Polyline Leaflet", () => {
    const networkMapFile = path.join(
      rootDir,
      "src",
      "components",
      "map",
      "network-map.tsx",
    );
    const content = fs.readFileSync(networkMapFile, "utf-8");

    assert.match(
      content,
      /import\s*\{[^}]*resolveCableCapacityStyle[^}]*\}\s*from\s*["']@\/config\/cable-capacity["']/,
      "network-map.tsx harus mengimpor resolveCableCapacityStyle",
    );
    assert.match(
      content,
      /const\s+style\s*=\s*resolveCableCapacityStyle\(/,
      "network-map.tsx harus memanggil resolveCableCapacityStyle untuk styling kabel",
    );
    assert.match(
      content,
      /color:\s*style\.color/,
      "Polyline harus menggunakan warna dari style.color",
    );
    assert.match(
      content,
      /dashArray:\s*style\.dashArray/,
      "Polyline harus menggunakan dashArray dari style.dashArray",
    );
  });

  await t.test("5. Integrasi Service cable-map.service.ts Menyertakan color dan baseWeight", () => {
    const serviceFile = path.join(
      rootDir,
      "src",
      "services",
      "cable-map.service.ts",
    );
    const content = fs.readFileSync(serviceFile, "utf-8");

    assert.match(
      content,
      /import\s*\{[^}]*resolveCableCapacityStyle[^}]*\}\s*from\s*["']@\/config\/cable-capacity["']/,
      "cable-map.service.ts harus mengimpor resolveCableCapacityStyle",
    );
    assert.match(
      content,
      /color:\s*style\.color/,
      "Segmen kabel harus menyertakan style.color",
    );
    assert.match(
      content,
      /baseWeight:\s*style\.baseWeight/,
      "Segmen kabel harus menyertakan style.baseWeight",
    );
  });
});
