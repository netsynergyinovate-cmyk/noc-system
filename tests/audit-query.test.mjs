import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { parseAuditQuery, buildAuditConditions, escapeLike, clampAuditLimit } =
  await import("../src/lib/audit-query.ts");

const parse = (qs) => parseAuditQuery(new URLSearchParams(qs));

test("default limit 50, parameter kosong diabaikan", () => {
  assert.deepEqual(parse(""), { limit: 50 });
  assert.deepEqual(parse("q=&action="), { limit: 50 });
});

test("limit 1..500, di luar itu ditolak", () => {
  assert.equal(parse("limit=1").limit, 1);
  assert.equal(parse("limit=500").limit, 500);
  for (const bad of ["limit=0", "limit=501", "limit=abc", "limit=1.5"])
    assert.throws(() => parse(bad), bad);
});

test("before menerima epoch ms dan ISO, menolak sampah", () => {
  assert.equal(parse("before=1700000000000").before.getTime(), 1700000000000);
  assert.equal(
    parse("before=2024-01-02T03:04:05Z").before.toISOString(),
    "2024-01-02T03:04:05.000Z",
  );
  assert.throws(() => parse("before=nope"));
});

test("filter teks dipangkas, kunci asing ditolak", () => {
  assert.deepEqual(parse("action=%20login%20&userId=u1&q=router"), {
    limit: 50,
    action: "login",
    userId: "u1",
    q: "router",
  });
  assert.throws(() => parse("bogus=1"));
  assert.throws(() => parse(`q=${"x".repeat(201)}`));
});

test("kondisi filter: satu per opsi, q = OR dua kolom", () => {
  assert.equal(buildAuditConditions({}).length, 0);
  assert.equal(buildAuditConditions({ action: "a" }).length, 1);
  assert.equal(
    buildAuditConditions({
      before: new Date(),
      action: "a",
      userId: "u",
      q: "x",
    }).length,
    4,
  );
});

test("escapeLike dan clamp limit", () => {
  assert.equal(escapeLike("50%_a\\b"), "50\\%\\_a\\\\b");
  assert.equal(clampAuditLimit(), 50);
  assert.equal(clampAuditLimit(0), 50);
  assert.equal(clampAuditLimit(9999), 500);
  assert.equal(clampAuditLimit(-5), 1);
});
