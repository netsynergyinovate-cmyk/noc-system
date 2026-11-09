import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { mapMikrotikError, MikrotikError } =
  await import("../src/lib/mikrotik/errors.ts");
const { DeviceConnectionError } =
  await import("../src/lib/device-connection.ts");

const dce = (code) => new DeviceConnectionError(code, `pesan ${code}`);

test("TIMEOUT: 504, retryable", () => {
  const m = mapMikrotikError(dce("TIMEOUT"));
  assert.deepEqual([m.code, m.status, m.retryable], ["TIMEOUT", 504, true]);
  assert.match(m.hint, /timeout|tepat waktu/i);
  assert.equal(mapMikrotikError({ name: "AbortError" }).code, "TIMEOUT");
});

test("AUTH_FAILED: 502, non-retryable, hint username/password; HTTP 401/403", () => {
  const m = mapMikrotikError(dce("AUTH_FAILED"));
  assert.deepEqual(
    [m.code, m.status, m.retryable],
    ["AUTH_FAILED", 502, false],
  );
  assert.match(m.hint, /username.*password/i);
  assert.equal(mapMikrotikError(401).code, "AUTH_FAILED");
  assert.equal(mapMikrotikError("403").code, "AUTH_FAILED");
});

test("NOT_FOUND: memuat command www-ssl; HTTP 404", () => {
  const m = mapMikrotikError(dce("NOT_FOUND"));
  assert.deepEqual([m.code, m.status, m.retryable], ["NOT_FOUND", 502, false]);
  assert.equal(m.command, "/ip service set www-ssl disabled=no");
  assert.equal(mapMikrotikError(404).code, "NOT_FOUND");
});

test("CONNECTION_REFUSED: command hanya memeriksa layanan www (tidak memaksa port); ECONNREFUSED", () => {
  const m = mapMikrotikError(dce("CONNECTION_REFUSED"));
  assert.deepEqual(
    [m.code, m.status, m.retryable],
    ["CONNECTION_REFUSED", 502, true],
  );
  // Tidak boleh memindahkan www ke port lain: router yang sengaja memakai port non-80 akan rusak.
  assert.equal(m.command, '/ip service print where name~"www"');
  assert.doesNotMatch(m.command, /port=/);
  assert.match(m.hint, /isi port itu di form|IP:port/i);
  const n = mapMikrotikError(
    Object.assign(new Error("fetch failed"), {
      cause: { code: "ECONNREFUSED" },
    }),
  );
  assert.equal(n.code, "CONNECTION_REFUSED");
});

test("INVALID_HOST: 422, non-retryable", () => {
  const m = mapMikrotikError(dce("INVALID_HOST"));
  assert.deepEqual(
    [m.code, m.status, m.retryable],
    ["INVALID_HOST", 422, false],
  );
});

test("DNS_ERROR, ETIMEDOUT, 5xx", () => {
  const d = mapMikrotikError(dce("DNS_ERROR"));
  assert.deepEqual([d.code, d.status, d.retryable], ["DNS_ERROR", 502, true]);
  assert.equal(
    mapMikrotikError(Object.assign(new Error("x"), { code: "ENOTFOUND" })).code,
    "DNS_ERROR",
  );
  assert.equal(
    mapMikrotikError(Object.assign(new Error("x"), { code: "ETIMEDOUT" })).code,
    "TIMEOUT",
  );
  assert.equal(mapMikrotikError(503).code, "HTTP_ERROR");
});

test("MikrotikError dikembalikan apa adanya", () => {
  const mapped = mapMikrotikError(dce("TIMEOUT"));
  const e = new MikrotikError(mapped, new Error("asal"));
  assert.ok(e instanceof DeviceConnectionError);
  assert.equal(e.code, "TIMEOUT");
  assert.equal(mapMikrotikError(e), mapped);
});

test("fallback aman untuk null/unknown", () => {
  for (const bad of [
    null,
    undefined,
    {},
    42.5,
    "aneh",
    Symbol("x"),
    [],
    new Error("boom"),
  ]) {
    const m = mapMikrotikError(bad);
    assert.equal(m.code, "CONNECTION_FAILED");
    assert.equal(m.status, 502);
    assert.ok(m.message && m.title && m.hint);
  }
});

test("galat sertifikat/TLS dipetakan ke TLS_ERROR, bukan galat jaringan umum", () => {
  for (const code of [
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "CERT_HAS_EXPIRED",
    "ERR_SSL_WRONG_VERSION_NUMBER",
  ]) {
    const m = mapMikrotikError(
      Object.assign(new Error("fetch failed"), { cause: { code } }),
      { host: "10.0.0.5", port: 443 },
    );
    assert.equal(m.code, "TLS_ERROR", code);
    assert.ok(m.hint && m.title);
  }
  assert.equal(
    mapMikrotikError(new DeviceConnectionError("WRONG_PORT", "x")).code,
    "WRONG_PORT",
  );
  // fetch failed biasa tetap galat jaringan
  assert.equal(
    mapMikrotikError(
      Object.assign(new Error("fetch failed"), {
        cause: { code: "EHOSTUNREACH" },
      }),
    ).code,
    "NETWORK_ERROR",
  );
});
