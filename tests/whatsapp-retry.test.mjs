import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { retryRows } = await import("../src/lib/dashboard/whatsapp-retry.ts");

const row = (id) => ({ id, recipientTarget: `62${id}`, message: "m" });

test("hitung retried/succeeded/failed dan simpan hasil tiap baris", async () => {
  const saved = {};
  const r = await retryRows(
    [row("1"), row("2"), row("3")],
    async (x) => {
      if (x.id === "1") return { ok: true };
      if (x.id === "2") return { ok: false, error: "HTTP 500" };
      throw new Error("ECONNREFUSED");
    },
    async (id, res) => {
      saved[id] = res;
    },
  );
  assert.deepEqual(r, { retried: 3, succeeded: 1, failed: 2 });
  assert.deepEqual(saved["1"], { ok: true });
  assert.equal(saved["2"].error, "HTTP 500");
  assert.equal(saved["3"].error, "ECONNREFUSED");
});

test("tidak ada log failed = 0 retried, tanpa panggil send/save", async () => {
  let calls = 0;
  const r = await retryRows([], async () => (calls++, { ok: true }), async () => void calls++);
  assert.deepEqual(r, { retried: 0, succeeded: 0, failed: 0 });
  assert.equal(calls, 0);
});
