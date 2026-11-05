import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { runRouterTest, buildRouterTestDevice, DEFAULT_ROUTER_TEST_FORM } from "../src/lib/dashboard/router-test.ts";

const page = "src/app/(protected)/app/router/test/page.tsx";
const board = "src/components/dashboard/router-test-board.tsx";
const list = "src/app/(protected)/app/router/page.tsx";

test("halaman uji: metadata, default export, requireSession", () => {
  assert.ok(existsSync(page));
  const s = readFileSync(page, "utf8");
  assert.match(s, /export const metadata[^]*title: "Uji Koneksi Router"/);
  assert.match(s, /export default async function/);
  assert.match(s, /await requireSession\(\)/);
  assert.match(s, /<RouterTestBoard \/>/);
});

test("komponen RouterTestBoard diekspor", () => {
  assert.ok(existsSync(board));
  const s = readFileSync(board, "utf8");
  assert.match(s, /^"use client"/);
  assert.match(s, /export function RouterTestBoard/);
});

test("halaman Kelola Router menaut ke /app/router/test", () => {
  assert.match(readFileSync(list, "utf8"), /href="\/app\/router\/test"/);
});

test("runRouterTest forceLocal: sukses (khusus pengujian offline)", async () => {
  const r = await runRouterTest({
    ...DEFAULT_ROUTER_TEST_FORM,
    host: "10.10.0.1",
    username: "admin",
    forceLocal: true,
  });
  assert.equal(r.ok, true);
  assert.equal(r.outcome.ok, true);
  assert.equal(r.outcome.code, "OK");
});

test("runRouterTest forceLocal: galat timeout, ditolak, auth, validasi", async () => {
  const base = { ...DEFAULT_ROUTER_TEST_FORM, username: "admin", forceLocal: true };
  assert.equal((await runRouterTest({ ...base, host: "10.10.0.0" })).outcome.code, "TIMEOUT");
  assert.equal((await runRouterTest({ ...base, host: "10.10.0.1", port: "9999" })).outcome.code, "CONNECTION_REFUSED");
  assert.equal((await runRouterTest({ ...base, host: "10.10.0.1", username: "bad-user" })).outcome.code, "AUTH_FAILED");
  const bad = await runRouterTest({ ...base, host: "", port: "70000" });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.host && bad.errors.port);
  assert.equal(buildRouterTestDevice({ ...base, host: "1.2.3.4" }).ok, true);
});
