import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";

register();
const { encryptWithKey, decryptWithKey } = await import(
  "../src/lib/encryption-core.ts"
);

const KEY = "k".repeat(32);

test("password OLT: enkripsi -> iv:tag:ciphertext -> dekripsi sama", () => {
  const plain = "OltP@ss w0rd!";
  const stored = encryptWithKey(plain, KEY);
  const parts = stored.split(":");
  assert.equal(parts.length, 3);
  assert.equal(Buffer.from(parts[0], "base64").length, 12);
  assert.equal(Buffer.from(parts[1], "base64").length, 16);
  assert.ok(!stored.includes(plain));
  assert.equal(decryptWithKey(stored, KEY), plain);
  assert.notEqual(encryptWithKey(plain, KEY), stored);
  assert.throws(() => decryptWithKey(stored, "x".repeat(32)));
});

test("objek publik OLT tidak memuat password / passwordEnc", () => {
  const src = readFileSync(
    new URL("../src/services/devices.service.ts", import.meta.url),
    "utf8",
  );
  const block = src.match(/const publicOltColumns = \{([\s\S]*?)\n\};/)?.[1];
  assert.ok(block, "publicOltColumns tidak ditemukan");
  assert.ok(!/password/i.test(block));
  const create = src.match(/export async function createOlt[\s\S]*?\n\}/)[0];
  assert.match(create, /\.returning\(publicOltColumns\)/);
  const list = src.match(/export async function listDevices[\s\S]*?\n\}/)[0];
  assert.match(list, /select\(publicOltColumns\)/);
});
