import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const servicePath = path.resolve(__dirname, "../src/services/real-map-markers.service.ts");

test("Buat service ambil penanda dari database nyata (real-map-markers.service)", async (t) => {
  const content = fs.readFileSync(servicePath, "utf8");

  await t.test("Menggunakan import server-only dan skema database PostgreSQL resmi", () => {
    assert.match(content, /import "server-only";/, "Harus server-only");
    assert.match(content, /from "@\/db"/, "Harus mengimpor koneksi db Drizzle");
    assert.match(
      content,
      /from "@\/db\/schema"/,
      "Harus mengimpor tabel customers, olts, oltOnus, routers",
    );
  });

  await t.test("Menjalankan query SQL join pelanggan dengan router dan ONU", () => {
    assert.match(content, /db\s*\.select\(/, "Harus melakukan select query");
    assert.match(content, /\.from\(customers\)/, "Harus menargetkan tabel customers");
    assert.match(content, /\.leftJoin\(routers,/, "Harus melakukan leftJoin ke routers");
    assert.match(content, /\.leftJoin\(oltOnus,/, "Harus melakukan leftJoin ke oltOnus");
    assert.match(content, /\.from\(olts\)/, "Harus query tabel olts");
    assert.match(content, /\.from\(routers\)/, "Harus query tabel routers");
  });

  await t.test("Zero-Dummy Compliance: Tidak memiliki daftar array dummy hardcoded", () => {
    assert.doesNotMatch(
      content,
      /Budi Santoso|Ahmad Hidayat|Siti Rahma/,
      "Dilarang menyematkan data dummy hardcoded di service database riil",
    );
  });

  await t.test("Metadata dataSource menyatakan PostgreSQL Operasional secara transparan", () => {
    assert.match(
      content,
      /provider:\s*"PostgreSQL Database \(NOC Operational\)"/,
      "Harus menyatakan sumber data riil PostgreSQL",
    );
    assert.match(content, /isRealData:\s*true/, "isRealData wajib true");
  });

  await t.test("Membedakan pelanggan dengan koordinat valid vs belum terpetakan", () => {
    assert.match(content, /hasCoordinates/, "Harus menyertakan flag hasCoordinates");
    assert.match(content, /geocodedCustomers/, "Harus menyaring pelanggan yang memiliki koordinat");
    assert.match(content, /unmappedCustomers/, "Harus menghitung jumlah pelanggan belum terpetakan");
  });
});
