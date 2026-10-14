import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { capabilities, capabilityPermissions } = await import("../src/lib/access.ts");
const { roleCan } = await import("../src/lib/roles.ts");

test("capability dipetakan ke izin yang benar", () => {
  assert.deepEqual(capabilityPermissions("manageThresholds"), { threshold: ["manage"] });
  assert.deepEqual(capabilityPermissions("viewAuditLog"), { audit: ["read"] });
  assert.ok(Object.isFrozen(capabilities.manageThresholds));
  assert.ok(Object.isFrozen(capabilities.viewAuditLog));
});

test("admin boleh manageThresholds dan viewAuditLog", () => {
  assert.equal(roleCan("admin", capabilities.manageThresholds), true);
  assert.equal(roleCan("admin", capabilities.viewAuditLog), true);
});

test("user biasa tidak boleh manageThresholds tapi boleh viewAuditLog", () => {
  assert.equal(roleCan("user", capabilities.manageThresholds), false);
  assert.equal(roleCan("user", capabilities.viewAuditLog), true);
});
