import test from "node:test";
import assert from "node:assert/strict";
import { parseCpeWifiError } from "../src/lib/dashboard/cpe-wifi-errors.ts";

test("409 -> TASK_CONFLICT dengan saran antrean", () => {
  const v = parseCpeWifiError(409);
  assert.equal(v.code, "TASK_CONFLICT");
  assert.match(v.hint, /antrean GenieACS/);
  assert.equal(v.canRetry, true);
});

test("504 dan code CPE_OFFLINE -> CPE_OFFLINE dengan saran periksa modem", () => {
  for (const v of [parseCpeWifiError(504), parseCpeWifiError(500, { code: "CPE_OFFLINE" }), parseCpeWifiError(502, { error: { code: "DEVICE_UNREACHABLE" } })]) {
    assert.equal(v.code, "CPE_OFFLINE");
    assert.match(v.hint, /modem menyala/);
  }
});

test("422 dan FAULT_9003/9005 -> PARAMETER_FAULT dengan saran karakter", () => {
  for (const v of [parseCpeWifiError(422), parseCpeWifiError(500, { code: "FAULT_9003" }), parseCpeWifiError(500, { code: "FAULT_9005" })]) {
    assert.equal(v.code, "PARAMETER_FAULT");
    assert.match(v.hint, /karakter/);
    assert.equal(v.canRetry, false);
  }
});

test("403 -> FORBIDDEN dengan saran izin, 401 -> UNAUTHORIZED", () => {
  const f = parseCpeWifiError(403);
  assert.equal(f.code, "FORBIDDEN");
  assert.match(f.hint, /cpe:manage/);
  assert.equal(parseCpeWifiError(401).code, "UNAUTHORIZED");
});

test("status 0 -> NETWORK_ERROR", () => {
  const v = parseCpeWifiError(0);
  assert.equal(v.code, "NETWORK_ERROR");
  assert.match(v.hint, /7557/);
});

test("fallback untuk status asing dan body sampah", () => {
  assert.equal(parseCpeWifiError(418).code, "UNKNOWN");
  assert.equal(parseCpeWifiError(500, null).code, "UNKNOWN");
  assert.equal(parseCpeWifiError(500, "x").code, "UNKNOWN");
  assert.equal(parseCpeWifiError(500, { code: 5 }).code, "UNKNOWN");
});
