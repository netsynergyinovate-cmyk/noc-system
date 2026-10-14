import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";
delete process.env.ROUTER_SECRET_KEY;

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();
const { encryptWithKey, decryptWithKey } = await import("../src/lib/encryption-core.ts");
const { env } = await import("../src/lib/env.ts");
const { encryptDeviceCredential, decryptDeviceCredential } = await import("../src/lib/encryption.ts");
const { encryptCredential, decryptCredential } = await import(
  "../src/services/device-credentials.service.ts"
);

const KEY = "k".repeat(32);
const SAMPLES = ["abc123", "P@ss w0rd!#$%^&*()", "  spasi  ", "sandi-ÄÖü-日本語-🔐", "", "a:b:c"];

test("roundtrip core: alfanumerik, simbol, spasi, unicode", () => {
  for (const t of SAMPLES) assert.equal(decryptWithKey(encryptWithKey(t, KEY), KEY), t);
});

test("IV unik: ciphertext berbeda untuk plaintext sama", () => {
  const set = new Set(Array.from({ length: 50 }, () => encryptWithKey("sama", KEY)));
  assert.equal(set.size, 50);
});

test("format iv:tag:ciphertext (IV 12 byte, tag 16 byte)", () => {
  const p = encryptWithKey("abc", KEY).split(":");
  assert.equal(p.length, 3);
  assert.equal(Buffer.from(p[0], "base64").length, 12);
  assert.equal(Buffer.from(p[1], "base64").length, 16);
});

test("anti-tampering: tag atau ciphertext diubah -> error", () => {
  const [iv, tag, ct] = encryptWithKey("rahasia", KEY).split(":");
  const flip = (s) => { const b = Buffer.from(s, "base64"); b[0] ^= 1; return b.toString("base64"); };
  assert.throws(() => decryptWithKey(`${iv}:${flip(tag)}:${ct}`, KEY));
  assert.throws(() => decryptWithKey(`${iv}:${tag}:${flip(ct)}`, KEY));
});

test("zero-leakage: plaintext tidak ada di ciphertext", () => {
  const plain = "SuperSecretPassword";
  const enc = encryptWithKey(plain, KEY);
  assert.ok(!enc.includes(plain));
  assert.ok(!Buffer.from(enc.split(":")[2], "base64").toString("utf8").includes(plain));
});

test("kunci salah -> error", () => {
  assert.throws(() => decryptWithKey(encryptWithKey("x", KEY), "z".repeat(32)));
});

test("encryptDeviceCredential/decryptDeviceCredential memakai DEVICE_SECRET", () => {
  env.DEVICE_SECRET = KEY;
  for (const t of SAMPLES) {
    const enc = encryptDeviceCredential(t);
    assert.equal(decryptDeviceCredential(enc), t);
    assert.equal(decryptWithKey(enc, KEY), t);
  }
  assert.notEqual(encryptDeviceCredential("a"), encryptDeviceCredential("a"));
});

test("fallback ke ROUTER_SECRET_KEY bila DEVICE_SECRET kosong", () => {
  env.DEVICE_SECRET = undefined;
  process.env.ROUTER_SECRET_KEY = "r".repeat(32);
  const enc = encryptDeviceCredential("pw");
  assert.equal(decryptWithKey(enc, "r".repeat(32)), "pw");
  assert.equal(decryptDeviceCredential(enc), "pw");
  delete process.env.ROUTER_SECRET_KEY;
});

test("secret belum diset -> error deskriptif tanpa bocor plaintext", () => {
  env.DEVICE_SECRET = undefined;
  delete process.env.ROUTER_SECRET_KEY;
  const plain = "plaintext-rahasia";
  assert.throws(() => encryptDeviceCredential(plain), (e) => {
    assert.match(e.message, /DEVICE_SECRET/);
    assert.ok(!e.message.includes(plain));
    return true;
  });
  assert.throws(() => decryptDeviceCredential("a:b:c"), /DEVICE_SECRET/);
});

test("kunci berganti -> dekripsi data lama gagal", () => {
  env.DEVICE_SECRET = KEY;
  const enc = encryptDeviceCredential("pw");
  env.DEVICE_SECRET = "y".repeat(32);
  assert.throws(() => decryptDeviceCredential(enc));
});

test("service: encryptCredential/decryptCredential roundtrip + kompatibel", () => {
  env.DEVICE_SECRET = KEY;
  for (const t of SAMPLES) {
    const enc = encryptCredential(t);
    assert.equal(decryptCredential(enc), t);
    assert.equal(decryptDeviceCredential(enc), t);
  }
});

test("service: GenieACS dari env, null bila URL kosong", async () => {
  const { getGenieacsDecryptedCredentials } = await import(
    "../src/services/device-credentials.service.ts"
  );
  env.GENIEACS_NBI_URL = undefined;
  assert.equal(await getGenieacsDecryptedCredentials(), null);
  env.GENIEACS_NBI_URL = "http://10.0.0.5:7557";
  env.GENIEACS_NBI_USER = "u";
  env.GENIEACS_NBI_PASSWORD = "p";
  assert.deepEqual(await getGenieacsDecryptedCredentials(), {
    url: "http://10.0.0.5:7557", username: "u", password: "p",
  });
});
