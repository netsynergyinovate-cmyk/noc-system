import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { displayNameFromOnu } = await import("../src/lib/dashboard/onu-name.ts");
const { onuNameCode } = await import("../src/lib/dashboard/onu-matcher.ts");

test("nama pelanggan diambil dari nama ONU tanpa kode", () => {
  assert.equal(displayNameFromOnu("1103-ALDI FAREZI"), "ALDI FAREZI");
  assert.equal(displayNameFromOnu("  1396-BUDI   SANTOSO "), "BUDI SANTOSO");
  assert.equal(
    displayNameFromOnu("1542-KANTOR DESA KARANG JAYA"),
    "KANTOR DESA KARANG JAYA",
  );
});

test("nama bawaan OLT dan kosong bukan nama orang", () => {
  for (const raw of [
    "ONU01/23",
    "onu 2 / 9",
    "1861-PPPoE Cust 17060001861",
    "1100-PPPoE C",
    "NO-DESCRIPTION",
    "-",
    "",
    null,
    undefined,
    "1234-",
    "1234-5678",
  ]) {
    assert.equal(displayNameFromOnu(raw), null, String(raw));
  }
});

test("kode nama ONU", () => {
  assert.equal(onuNameCode("1103-ALDI"), "1103");
  assert.equal(onuNameCode("1798"), "1798"); // ONU yang diberi kode saja, tanpa nama
  assert.equal(onuNameCode("1798 BARU"), null);
  assert.equal(onuNameCode("ONU01/23"), null);
  assert.equal(onuNameCode(null), null);
  assert.equal(onuNameCode("12-AB"), null); // terlalu pendek untuk kode
});
