import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const {
  encryptSecret,
  decryptSecret,
  serializeCookies,
  deserializeCookies,
  isBackoffActive,
  calculateNextBackoff,
} = await import("../src/services/billing-credentials.service.ts");

const key = "k".repeat(32);

test("round-trip password dan cookies; ciphertext 3 segmen base64", () => {
  const cookies = serializeCookies({ sid: "abc=", t: "x;y" });
  for (const plain of ["p@ss wörd 🔐", cookies, ""]) {
    const enc = encryptSecret(plain, key);
    const parts = enc.split(":");
    assert.equal(parts.length, 3);
    for (const p of parts) assert.match(p, /^[A-Za-z0-9+/]*={0,2}$/);
    assert.notEqual(enc, plain);
    assert.equal(decryptSecret(enc, key), plain);
  }
  assert.notEqual(encryptSecret("a", key), encryptSecret("a", key)); // IV acak
});

test("ciphertext rusak/termanipulasi atau kunci salah ditolak", () => {
  const [iv, tag, ct] = encryptSecret("rahasia", key).split(":");
  const flip = (b64) => {
    const b = Buffer.from(b64, "base64");
    b[0] ^= 1;
    return b.toString("base64");
  };
  assert.throws(() => decryptSecret([iv, tag, flip(ct)].join(":"), key));
  assert.throws(() => decryptSecret([iv, flip(tag), ct].join(":"), key));
  assert.throws(() => decryptSecret([flip(iv), tag, ct].join(":"), key));
  assert.throws(() => decryptSecret([iv, tag].join(":"), key), /Invalid encrypted format/);
  assert.throws(() => decryptSecret("bukan-ciphertext", key));
  assert.throws(() => decryptSecret([iv, tag, ct].join(":"), "z".repeat(32)));
});

test("tanpa kunci dan tanpa DEVICE_SECRET: error", () => {
  const old = process.env.DEVICE_SECRET;
  delete process.env.DEVICE_SECRET;
  try {
    assert.throws(() => encryptSecret("x"), /DEVICE_SECRET/);
    process.env.DEVICE_SECRET = key;
    assert.equal(decryptSecret(encryptSecret("x")), "x");
  } finally {
    if (old === undefined) delete process.env.DEVICE_SECRET;
    else process.env.DEVICE_SECRET = old;
  }
});

test("serializeCookies/deserializeCookies: objek dan array", () => {
  assert.deepEqual(deserializeCookies(serializeCookies({ a: "1", b: "2" })), { a: "1", b: "2" });
  assert.deepEqual(
    deserializeCookies(serializeCookies([{ name: "a", value: "1" }, { name: "a", value: "2" }])),
    { a: "2" },
  );
  assert.deepEqual(deserializeCookies("{}"), {});
  const proto = deserializeCookies('{"__proto__":"x"}');
  assert.equal(Object.getPrototypeOf(proto), Object.prototype);
  assert.equal(Object.keys(proto)[0], "__proto__");
  for (const bad of ["[]", "null", '"x"', '{"a":1}', "bukan json"]) {
    assert.throws(() => deserializeCookies(bad), bad);
  }
});

test("backoff 6 jam hanya saat gagal >= 3", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  assert.equal(calculateNextBackoff(0, now), null);
  assert.equal(calculateNextBackoff(2, now), null);
  for (const n of [3, 4, 50]) {
    assert.equal(calculateNextBackoff(n, now).toISOString(), "2026-01-01T06:00:00.000Z");
  }
});

test("isBackoffActive: tepat di batas sudah tidak aktif", () => {
  const until = new Date("2026-01-01T06:00:00Z");
  assert.equal(isBackoffActive(null), false);
  assert.equal(isBackoffActive(until, new Date("2026-01-01T05:59:59.999Z")), true);
  assert.equal(isBackoffActive(until, until), false);
  assert.equal(isBackoffActive(until, new Date("2026-01-01T06:00:01Z")), false);
});
