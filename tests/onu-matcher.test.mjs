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

test("nama ONU memuat nomor PPPoE utuh -> name_pppoe", () => {
  const cs = [
    { id: "a", name: "17060001861@runsnet.id", pppoeUsername: "17060001861@runsnet.id" },
    { id: "b", name: "17060001862@runsnet.id", pppoeUsername: "17060001862@runsnet.id" },
  ];
  assert.deepEqual(m({ description: "1861-PPPoE Cust 17060001861" }, cs), { status: "name_pppoe", customerId: "a" });
});

test("kode di awal nama ONU = ekor nomor PPPoE -> code_suffix, dengan pengaman", () => {
  const cs = [
    { id: "a", name: "17060001103@runsnet.id", pppoeUsername: "17060001103@runsnet.id" },
    { id: "b", name: "17060001104@runsnet.id", pppoeUsername: "17060001104@runsnet.id" },
    { id: "c", name: "budi", pppoeUsername: "budi01" }, // bukan nomor: tidak dicocokkan lewat kode
  ];
  assert.deepEqual(m({ description: "1103-ALDI FAREZI" }, cs), { status: "code_suffix", customerId: "a" });
  assert.deepEqual(m({ description: "1103" }, cs), { status: "code_suffix", customerId: "a" });
  // Kode kembar di OLT (dua ONU berkode 1103) tidak boleh dipakai.
  assert.deepEqual(m({ description: "1103-ALDI FAREZI" }, cs, { duplicateCodes: new Set(["1103"]) }), { status: "unmatched" });
  // Tidak ada ekor yang cocok.
  assert.deepEqual(m({ description: "9999-SIAPA" }, cs), { status: "unmatched" });
  // Dua pelanggan berekor sama -> ambigu, tidak menebak.
  const dup = [...cs, { id: "d", name: "x", pppoeUsername: "27060001103@runsnet.id" }];
  assert.deepEqual(m({ description: "1103-ALDI" }, dup), { status: "ambiguous", candidateIds: ["a", "d"] });
  // Nama bawaan OLT tanpa kode tidak mencocokkan apa pun.
  assert.deepEqual(m({ description: "ONU01/23" }, cs), { status: "unmatched" });
});

test("aturan yang lebih kuat menang atas kode", () => {
  const cs = [
    { id: "a", name: "A", pppoeUsername: "17060001103@runsnet.id", serialNumber: "AABBCCDDEEFF" },
    { id: "b", name: "B", pppoeUsername: "17060009999@runsnet.id" },
  ];
  assert.deepEqual(m({ macAddress: "aa:bb:cc:dd:ee:ff", description: "9999-LAIN" }, cs), { status: "exact_sn", customerId: "a" });
});
