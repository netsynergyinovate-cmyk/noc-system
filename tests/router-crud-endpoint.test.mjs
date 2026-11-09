import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { updateRouterSchema } = await import("../src/validators/routers.ts");

test("updateRouterSchema: memvalidasi input konfigurasi router", () => {
  const valid = {
    name: "Core CIARA Updated",
    host: "103.167.70.136",
    port: 80,
    username: "Monitor",
    status: "aktif",
  };

  assert.equal(updateRouterSchema.safeParse(valid).success, true);
  assert.equal(updateRouterSchema.safeParse({ name: "RTR" }).success, true);
  assert.equal(
    updateRouterSchema.safeParse({ status: "nonaktif" }).success,
    true,
  );
  assert.equal(
    updateRouterSchema.safeParse({ password: "NewSecretPassword123" }).success,
    true,
  );

  // Status tidak valid
  assert.equal(
    updateRouterSchema.safeParse({ status: "invalid_status" }).success,
    false,
  );
  // Port di luar batas
  assert.equal(updateRouterSchema.safeParse({ port: 70000 }).success, false);
  // Field tak dikenal
  assert.equal(
    updateRouterSchema.safeParse({ unknownField: true }).success,
    false,
  );
});
