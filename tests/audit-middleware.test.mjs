import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { sanitizeAuditDetail, createWithAudit } = await import(
  "../src/lib/audit-sanitize.ts"
);

test("redact field rahasia, termasuk objek dalam", () => {
  const out = sanitizeAuditDetail({
    name: "r1",
    password: "x",
    apiKey: "k",
    nested: { botToken: "t", deeper: [{ secret: "s", ok: 1 }] },
  });
  assert.equal(out.name, "r1");
  assert.equal(out.password, "[REDACTED]");
  assert.equal(out.apiKey, "[REDACTED]");
  assert.equal(out.nested.botToken, "[REDACTED]");
  assert.equal(out.nested.deeper[0].secret, "[REDACTED]");
  assert.equal(out.nested.deeper[0].ok, 1);
});

test("redact nilai yang tampak seperti kunci", () => {
  const out = sanitizeAuditDetail({
    a: "Bearer abc.def",
    b: "sk-abcdefgh1234",
    c: "ghp_abcdefgh1234",
    d: "ngpk_abcdefgh1234",
    e: "biasa saja",
  });
  for (const k of ["a", "b", "c", "d"]) assert.equal(out[k], "[REDACTED]");
  assert.equal(out.e, "biasa saja");
});

test("withAudit mencatat hanya untuk 2xx", async () => {
  const calls = [];
  const withAudit = createWithAudit(async (...a) => calls.push(a));
  const req = new Request("http://x/api/routers", { method: "POST" });
  const session = { user: { id: "u1" } };
  await withAudit({ action: "router-added" })(req, async () => new Response(null, { status: 201 }))(session);
  await withAudit({ action: "router-added" })(req, async () => new Response(null, { status: 422 }))(session);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["u1", "router-added", "/api/routers", { method: "POST" }]);
});
