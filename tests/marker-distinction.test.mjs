import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const networkMapPath = path.resolve(__dirname, "../src/components/map/network-map.tsx");
const legendPath = path.resolve(__dirname, "../src/components/map/network-map-legend.tsx");

test("Tampilkan penanda pelanggan berbeda dari perangkat", async (t) => {
  const baseContent = fs.readFileSync(networkMapPath, "utf8");
  const legendContent = fs.existsSync(legendPath) ? fs.readFileSync(legendPath, "utf8") : "";
  const content = baseContent + "\n" + legendContent;

  await t.test("Penanda pelanggan memiliki pembeda semantik data-marker-type='customer'", () => {
    assert.match(
      content,
      /data-marker-type="customer"/,
      "Customer marker container harus memiliki data-marker-type='customer'",
    );
  });

  await t.test("Penanda perangkat memiliki pembeda semantik data-marker-type router/olt/odp", () => {
    assert.match(
      content,
      /data-marker-type=\{infra\.type\}/,
      "Device marker container harus memiliki data-marker-type sesuai tipenya",
    );
  });

  await t.test("Penanda pelanggan memiliki geometri lebih ramping dibanding perangkat", () => {
    // Radius pelanggan 5-6px vs perangkat 8-12px
    assert.match(
      content,
      /radius=\{isWeak \|\| isIsolir \? 6 : 5\}/,
      "Radius pelanggan harus 5-6px",
    );
    assert.match(
      content,
      /radius = isRouter \? 12 : isOlt \? 10 : 8/,
      "Radius perangkat harus 8-12px",
    );
  });

  await t.test("Perangkat router dan OLT memiliki concentric halo vector pembesar", () => {
    assert.match(
      content,
      /\(isRouter \|\| isOlt\) && \(\s*<CircleMarker[\s\S]*radius=\{radius \+ 6\}/,
      "Router dan OLT harus memiliki concentric halo",
    );
  });

  await t.test("Pelanggan isolir memiliki cincin visual pembeda tagihan", () => {
    assert.match(
      content,
      /isIsolir && \(\s*<CircleMarker[\s\S]*color: "#f43f5e"/,
      "Pelanggan isolir harus memiliki cincin pembeda isolir",
    );
  });

  await t.test("Tooltip pelanggan dan perangkat menampilkan rincian yang berbeda", () => {
    // Tooltip pelanggan menampilkan PPPoE username dan status tagihan
    assert.match(
      content,
      /cust\.pppoeUsername/,
      "Tooltip pelanggan harus menampilkan PPPoE username",
    );
    assert.match(
      content,
      /cust\.billingStatus/,
      "Tooltip pelanggan harus menampilkan status billing",
    );

    // Tooltip perangkat menampilkan host dan connected customers
    assert.match(
      content,
      /infra\.host/,
      "Tooltip perangkat harus menampilkan host IP",
    );
    assert.match(
      content,
      /Pelanggan Terhubung/,
      "Tooltip ODP harus menampilkan jumlah pelanggan terhubung",
    );
  });

  await t.test("Legenda peta menampilkan pembeda simbol penanda pelanggan dan perangkat", () => {
    assert.match(
      content,
      /data-testid="marker-legend-symbols"/,
      "Legenda harus memiliki kontainer marker-legend-symbols",
    );
    assert.match(content, /Pelanggan/, "Legenda memuat label Pelanggan");
    assert.match(content, /(?:Router Core|Core Router)/, "Legenda memuat label Router Core");
    assert.match(content, /OLT/, "Legenda memuat label OLT");
    assert.match(content, /ODP/, "Legenda memuat label ODP");
  });
});
