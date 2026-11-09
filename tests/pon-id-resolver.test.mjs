import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { isValidPonId, parsePonId, getPonPortDetailOrNull } =
  await import("../src/lib/dashboard/pon-ports.ts");

const UUID = "123e4567-e89b-42d3-a456-426614174000";

test("isValidPonId: format mock dan UUID sah", () => {
  for (const id of ["olt-1-pon-1", `${UUID}:3`, `${UUID}-pon-12`])
    assert.equal(isValidPonId(id), true, id);
});

test("isValidPonId: format lain ditolak", () => {
  for (const id of [
    "",
    "xyz",
    `${UUID}`,
    `${UUID}:`,
    `${UUID}:x`,
    `${UUID}:1\n`,
    `x${UUID}:1`,
    "123e4567:1",
    `${UUID}:1-2`,
  ]) {
    assert.equal(isValidPonId(id), false, JSON.stringify(id));
  }
});

test("parsePonId: mock", () => {
  assert.deepEqual(parsePonId("olt-2-pon-8"), {
    kind: "mock",
    oltNo: 2,
    ponIndex: 8,
  });
});

test("parsePonId: UUID dengan ':' dan '-pon-'", () => {
  assert.deepEqual(parsePonId(`${UUID}:3`), {
    kind: "db",
    oltId: UUID,
    ponIndex: 3,
  });
  assert.deepEqual(parsePonId(`${UUID}-pon-12`), {
    kind: "db",
    oltId: UUID,
    ponIndex: 12,
  });
  assert.equal(parsePonId("nope"), null);
});

test("getPonPortDetailOrNull: hanya mock; UUID diselesaikan di server", () => {
  assert.equal(getPonPortDetailOrNull("olt-1-pon-2")?.ponIndex, 2);
  assert.equal(getPonPortDetailOrNull(`${UUID}:1`), null);
});
