import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { refreshReducer, initialRefresh, mockRefresh } = await import("../src/lib/dashboard/refresh-state.ts");

test("idle -> loading -> success", () => {
  let s = refreshReducer(initialRefresh, { type: "start" });
  assert.equal(s.status, "loading");
  s = refreshReducer(s, { type: "success" });
  assert.equal(s.status, "idle");
});

test("idle -> loading -> error, lalu coba lagi", () => {
  let s = refreshReducer(initialRefresh, { type: "start" });
  s = refreshReducer(s, { type: "fail", message: "putus" });
  assert.deepEqual(s, { status: "error", message: "putus" });
  s = refreshReducer(s, { type: "start" });
  assert.equal(s.status, "loading");
});

test("start saat loading tidak memicu refresh ganda", () => {
  const loading = refreshReducer(initialRefresh, { type: "start" });
  assert.equal(refreshReducer(loading, { type: "start" }), loading);
});

test("success/fail di luar loading diabaikan", () => {
  assert.equal(refreshReducer(initialRefresh, { type: "success" }), initialRefresh);
  assert.equal(refreshReducer(initialRefresh, { type: "fail", message: "x" }), initialRefresh);
});

test("mockRefresh resolve saat online, reject saat offline", async () => {
  await mockRefresh(true, 1);
  await assert.rejects(mockRefresh(false, 1), /jaringan/);
});
