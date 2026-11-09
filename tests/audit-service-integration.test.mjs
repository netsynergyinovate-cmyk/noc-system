import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();

const { recordAudit, logOperatorAction, listAuditLogs, sanitizeAuditDetail } =
  await import("../src/services/audit.service.ts");
const { withAudit } = await import("../src/lib/audit-middleware.ts");

test("audit service: sanitizeAuditDetail membersihkan data sensitif", () => {
  const sanitized = sanitizeAuditDetail({
    username: "admin",
    password: "supersecretpassword",
    token: "ghp_1234567890abcdef",
    notes: "Ubah konfigurasi",
  });

  assert.equal(sanitized.username, "admin");
  assert.equal(sanitized.password, "[REDACTED]");
  assert.equal(sanitized.token, "[REDACTED]");
  assert.equal(sanitized.notes, "Ubah konfigurasi");
});

test("audit service: logOperatorAction dan recordAudit berjalan gagal-aman", async () => {
  const logged = await logOperatorAction({
    userId: "user-123",
    action: "threshold-changed",
    target: "Ambang CPU",
    summary: "CPU threshold dinaikkan ke 85%",
    changes: [{ field: "cpu", from: "70", to: "85" }],
  });

  // Di test env tanpa docker postgres, recordAudit menangkap error dan mengembalikan null
  // Fungsi tidak boleh melempar unhandled error.
  assert.ok(logged === null || typeof logged === "object");
});

test("audit service: listAuditLogs menghasilkan query Drizzle", () => {
  const query = listAuditLogs({ limit: 10, action: "login" });
  assert.ok(query);
  assert.equal(typeof query.then, "function");
});

test("withAudit middleware memicu pencatatan saat handler sukses", async () => {
  const calls = [];
  const customWithAudit = (
    await import("../src/lib/audit-sanitize.ts")
  ).createWithAudit(async (userId, action, target, detail) => {
    calls.push({ userId, action, target, detail });
  });

  const wrapped = customWithAudit({
    action: "router-added",
    getTarget: () => "/api/routers/r1",
  });

  const req = new Request("http://localhost:3000/api/routers", {
    method: "POST",
  });
  const session = { user: { id: "usr-admin" } };

  const handler = wrapped(req, async () => {
    return Response.json({ ok: true }, { status: 201 });
  });

  const res = await handler(session);
  assert.equal(res.status, 201);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "router-added");
  assert.equal(calls[0].userId, "usr-admin");
  assert.equal(calls[0].target, "/api/routers/r1");
});
