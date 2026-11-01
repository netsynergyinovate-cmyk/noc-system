import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { capabilities, capabilityPermissions } = await import("../src/lib/access.ts");
const { roleCan, isSuperAdmin, isAdmin, isStrictAdmin, isUser } = await import("../src/lib/roles.ts");
const { roles, ADMIN_ROLES, DEFAULT_ROLE } = await import("../src/lib/permissions.ts");
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

test("manageUsers hanya boleh dilakukan oleh superadmin, ditolak untuk admin dan user", () => {
  assert.deepEqual(capabilityPermissions("manageUsers"), { user: ["set-role"] });
  assert.equal(roleCan("superadmin", capabilities.manageUsers), true);
  assert.equal(roleCan("admin", capabilities.manageUsers), false);
  assert.equal(roleCan("user", capabilities.manageUsers), false);
});

test("Better Auth admin authorization: set-role, impersonate, set-password ditolak untuk admin dan user", () => {
  assert.equal(roles.superadmin.authorize({ user: ["set-role"] }).success, true);
  assert.equal(roles.superadmin.authorize({ user: ["impersonate"] }).success, true);
  assert.equal(roles.superadmin.authorize({ user: ["set-password"] }).success, true);

  assert.equal(roles.admin.authorize({ user: ["set-role"] }).success, false);
  assert.equal(roles.admin.authorize({ user: ["impersonate"] }).success, false);
  assert.equal(roles.admin.authorize({ user: ["set-password"] }).success, false);

  assert.equal(roles.user.authorize({ user: ["set-role"] }).success, false);
  assert.equal(roles.user.authorize({ user: ["impersonate"] }).success, false);
  assert.equal(roles.user.authorize({ user: ["set-password"] }).success, false);

  assert.deepEqual(ADMIN_ROLES, ["superadmin", "developer"]);
  assert.equal(DEFAULT_ROLE, "user");
});

test("helper peran membedakan superadmin, admin, dan user dengan tepat", () => {
  assert.equal(isSuperAdmin("superadmin"), true);
  assert.equal(isSuperAdmin("admin"), false);
  assert.equal(isSuperAdmin("user"), false);

  assert.equal(isAdmin("superadmin"), true);
  assert.equal(isAdmin("admin"), true);
  assert.equal(isAdmin("user"), false);

  assert.equal(isStrictAdmin("admin"), true);
  assert.equal(isStrictAdmin("superadmin"), false);
  assert.equal(isStrictAdmin("user"), false);

  assert.equal(isUser("user"), true);
  assert.equal(isUser("admin"), false);
  assert.equal(isUser("superadmin"), false);
});
