import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { encryptWithKey, decryptWithKey } = await import(
  "../src/lib/encryption-core.ts"
);

const key = "k".repeat(32);

test("roundtrip mengembalikan teks asli (termasuk unicode & kosong)", () => {
  for (const t of ["rahasia123", "pässwörd 🔐", "", "a:b:c"]) {
    assert.equal(decryptWithKey(encryptWithKey(t, key), key), t);
  }
});

test("kunci dengan panjang bukan 32 byte tetap bekerja", () => {
  for (const k of ["pendek", "x".repeat(100), "é".repeat(20)]) {
    assert.equal(decryptWithKey(encryptWithKey("hi", k), k), "hi");
  }
  assert.throws(() => encryptWithKey("hi", ""));
});

test("IV acak: enkripsi teks sama menghasilkan ciphertext berbeda", () => {
  assert.notEqual(encryptWithKey("sama", key), encryptWithKey("sama", key));
});

test("format iv:tag:ciphertext (base64, iv 12 byte, tag 16 byte)", () => {
  const parts = encryptWithKey("abc", key).split(":");
  assert.equal(parts.length, 3);
  assert.equal(Buffer.from(parts[0], "base64").length, 12);
  assert.equal(Buffer.from(parts[1], "base64").length, 16);
  assert.equal(Buffer.from(parts[2], "base64").length, 3);
});

test("auth tag dimanipulasi -> gagal", () => {
  const [iv, tag, ct] = encryptWithKey("abc", key).split(":");
  const b = Buffer.from(tag, "base64");
  b[0] ^= 1;
  assert.throws(() => decryptWithKey(`${iv}:${b.toString("base64")}:${ct}`, key));
});

test("ciphertext dimanipulasi -> gagal", () => {
  const [iv, tag, ct] = encryptWithKey("abcdef", key).split(":");
  const b = Buffer.from(ct, "base64");
  b[0] ^= 1;
  assert.throws(() => decryptWithKey(`${iv}:${tag}:${b.toString("base64")}`, key));
});

test("kunci salah & format rusak -> gagal", () => {
  const enc = encryptWithKey("abc", key);
  assert.throws(() => decryptWithKey(enc, "z".repeat(32)));
  assert.throws(() => decryptWithKey("bukan-format", key), /Invalid encrypted format/);
  assert.throws(() => decryptWithKey("a:b:c", key), /Invalid encrypted format/);
});
