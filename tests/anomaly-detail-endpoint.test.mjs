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

const { updateAnomalyStatusSchema } = await import(
  "../src/validators/anomalies.ts"
);
const {
  getAnomalyById,
  updateAnomalyStatus,
} = await import("../src/services/anomalies.service.ts");
const { loadAnomalies } = await import(
  "../src/lib/dashboard/anomaly-feed.ts"
);
const routeDetail = await import("../src/app/api/anomalies/[id]/route.ts");

test("validator: updateAnomalyStatusSchema memvalidasi status dan note", () => {
  const v = updateAnomalyStatusSchema.parse({
    status: "reviewed",
    reviewed: true,
    operator: "Ahmad",
    note: "Kabel sudah diganti",
  });
  assert.equal(v.status, "reviewed");
  assert.equal(v.reviewed, true);
  assert.equal(v.operator, "Ahmad");
  assert.equal(v.note, "Kabel sudah diganti");

  assert.throws(() =>
    updateAnomalyStatusSchema.parse({
      status: "bukan_status",
    }),
  );
});

test("getAnomalyById: mengambil detail anomali yang valid", async () => {
  const anomalies = await loadAnomalies();
  assert.ok(anomalies.length > 0);
  const sample = anomalies[0];

  const detail = await getAnomalyById(sample.id);
  assert.ok(detail);
  assert.equal(detail.anomaly.id, sample.id);
  assert.ok(detail.troubleshooting);
  assert.ok(Array.isArray(detail.troubleshooting.steps));
  assert.equal(typeof detail.reviewed, "boolean");
});

test("getAnomalyById: melempar error 404 bila id tidak ditemukan", async () => {
  await assert.rejects(
    () => getAnomalyById("id-tidak-ada-di-manapun-12345"),
    (err) => err.status === 404 || err.message.includes("tidak ditemukan"),
  );
});

test("updateAnomalyStatus: memperbarui status reviewed", async () => {
  const anomalies = await loadAnomalies();
  const sample = anomalies[0];

  const updated = await updateAnomalyStatus(sample.id, {
    reviewed: true,
    operator: "Operator NOC",
    note: "Sedang diperiksa",
  });

  assert.ok(updated);
  assert.equal(updated.reviewed, true);
  assert.equal(updated.note, "Sedang diperiksa");
});

test("route exports GET, PATCH, dan PUT", () => {
  assert.equal(typeof routeDetail.GET, "function");
  assert.equal(typeof routeDetail.PATCH, "function");
  assert.equal(typeof routeDetail.PUT, "function");
});
