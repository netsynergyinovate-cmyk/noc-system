import test from "node:test";
import assert from "node:assert/strict";
import { reviveDates } from "../src/services/map/undo-format.ts";

test("reviveDates: kolom timestamp dari JSONB kembali jadi Date, kolom lain utuh", () => {
  const row = JSON.parse(
    JSON.stringify({
      id: "a",
      createdAt: new Date("2026-10-21T00:00:00Z"),
      snappedAt: null,
      geometry: [[1, 2]],
    }),
  );
  const out = reviveDates(row);
  assert.ok(out.createdAt instanceof Date);
  assert.equal(out.createdAt.toISOString(), "2026-10-21T00:00:00.000Z");
  assert.equal(out.snappedAt, null);
  assert.deepEqual(out.geometry, [[1, 2]]);
  assert.equal(typeof row.createdAt, "string"); // masukan tidak diubah
});
