import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { matchOnuToCustomer: m } = await import("../src/lib/dashboard/onu-matcher.ts");

const customers = [
  { id: "1", name: "Budi Santoso", pppoeUsername: "budi01", serialNumber: "ZTEG1234ABCD" },
  { id: "2", name: "Dewi", pppoeUsername: "dewi02" },
  { id: "3", name: "Sama", pppoeUsername: "sama-a" },
  { id: "4", name: "sama", pppoeUsername: "sama-b" },
];

test("pppoe username, case-insensitive dan trim", () => {
  assert.deepEqual(m({ description: "  BUDI01 " }, customers), { status: "exact_pppoe", customerId: "1" });
});

test("nama pelanggan", () => {
  assert.deepEqual(m({ description: "budi santoso" }, customers), { status: "exact_name", customerId: "1" });
});

test("serial number / MAC (abaikan pemisah) menang atas deskripsi", () => {
  assert.deepEqual(m({ serialNumber: "zteg-1234-abcd", description: "dewi02" }, customers), {
    status: "exact_sn",
    customerId: "1",
  });
});

test("ambigu bila dua pelanggan cocok", () => {
  const r = m({ description: "SAMA" }, customers);
  assert.equal(r.status, "ambiguous");
  assert.deepEqual(r.candidateIds, ["3", "4"]);
});

test("tanpa kecocokan / deskripsi kosong -> unmatched", () => {
  assert.deepEqual(m({ description: "tidak-ada" }, customers), { status: "unmatched" });
  assert.deepEqual(m({ description: "  ", serialNumber: null }, customers), { status: "unmatched" });
});
