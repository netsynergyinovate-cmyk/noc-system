import test from "node:test";
import assert from "node:assert/strict";
import {
  getGenieacsConfig,
  sanitizeGenieacsUrl,
} from "../src/lib/genieacs/config.ts";

test("env kosong -> simulator, timeout 5000, url fallback", () => {
  const c = getGenieacsConfig({});
  assert.equal(c.mode, "simulator");
  assert.equal(c.timeoutMs, 5000);
  assert.equal(c.url, "http://genieacs-simulator.local:7557");
  assert.equal(c.authHeader, undefined);
});

test("live + env lengkap -> real + basic auth", () => {
  const c = getGenieacsConfig({
    DASHBOARD_DATA: "live",
    GENIEACS_NBI_URL: "http://10.10.2.1:7557/",
    GENIEACS_NBI_USER: "acs",
    GENIEACS_NBI_PASSWORD: "rahasia",
  });
  assert.equal(c.mode, "real");
  assert.equal(c.url, "http://10.10.2.1:7557");
  assert.equal(
    c.authHeader,
    `Basic ${Buffer.from("acs:rahasia").toString("base64")}`,
  );
});

test("live tanpa kredensial -> real tanpa authHeader", () => {
  const c = getGenieacsConfig({
    DASHBOARD_DATA: "live",
    GENIEACS_NBI_URL: "http://10.10.2.1:7557",
    GENIEACS_NBI_USER: "acs",
  });
  assert.equal(c.mode, "real");
  assert.equal(c.authHeader, undefined);
});

test("demo -> simulator walau URL disetel, tanpa kredensial", () => {
  const c = getGenieacsConfig({
    DASHBOARD_DATA: "demo",
    GENIEACS_NBI_URL: "http://10.10.2.1:7557",
    GENIEACS_NBI_USER: "acs",
    GENIEACS_NBI_PASSWORD: "x",
  });
  assert.equal(c.mode, "simulator");
  assert.equal(c.authHeader, undefined);
});

test("live tanpa URL -> simulator", () => {
  assert.equal(getGenieacsConfig({ DASHBOARD_DATA: "live" }).mode, "simulator");
});

test("GENIEACS_TIMEOUT_MS diparse; tidak sah -> 5000", () => {
  assert.equal(
    getGenieacsConfig({ GENIEACS_TIMEOUT_MS: "3000" }).timeoutMs,
    3000,
  );
  for (const bad of ["abc", "100", "999999", "1.5", ""]) {
    assert.equal(
      getGenieacsConfig({ GENIEACS_TIMEOUT_MS: bad }).timeoutMs,
      5000,
    );
  }
});

test("sanitizeGenieacsUrl membuang kredensial", () => {
  assert.equal(
    sanitizeGenieacsUrl("http://user:pass@host:7557/"),
    "http://host:7557",
  );
  assert.equal(
    sanitizeGenieacsUrl("https://h.example/nbi"),
    "https://h.example/nbi",
  );
  assert.throws(() => sanitizeGenieacsUrl("not a url"));
  assert.throws(() => sanitizeGenieacsUrl("ftp://h"));
});

test("URL bertanda kredensial di env tidak bocor ke config", () => {
  const c = getGenieacsConfig({
    DASHBOARD_DATA: "live",
    GENIEACS_NBI_URL: "http://u:p@h:7557",
  });
  assert.equal(c.url, "http://h:7557");
});
