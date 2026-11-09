import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { matchOnuToCustomer: m } =
  await import("../src/lib/dashboard/onu-matcher.ts");
const { callerIdLookupAllowed, sessionNameForOnu } =
  await import("../src/lib/dashboard/onu-caller-id.ts");

test("nama ONU 'KODE-NAMA' cocok dengan nama pelanggan tanpa kode", () => {
  const cs = [
    { id: "1", name: "RATIMIN", pppoeUsername: "17060001834@runsnet.id" },
  ];
  assert.deepEqual(m({ description: "1834-RATIMIN" }, cs), {
    status: "exact_name",
    customerId: "1",
  });
  assert.deepEqual(m({ description: "1121-RATIMIN JAYA" }, cs), {
    status: "unmatched",
  });
});

test("hanya model terukur yang boleh dicari lewat caller-id", () => {
  assert.equal(callerIdLookupAllowed("CDTC 15CR"), true);
  assert.equal(callerIdLookupAllowed("HWTC H113"), true);
  assert.equal(callerIdLookupAllowed("HSGQ 130W"), false);
  assert.equal(callerIdLookupAllowed(null), false);
});

test("sesi dengan caller-id ONU+1..3 dan lima oktet awal sama; satu kandidat saja", () => {
  const onu = "D0:5F:AF:D3:C7:1D";
  const s = (name, callerId, address = "10.0.0.1") => ({
    name,
    callerId,
    address,
  });
  assert.equal(
    sessionNameForOnu(onu, [
      s("a", "D0:5F:AF:D3:C7:1F"),
      s("b", "AA:BB:CC:00:00:01"),
    ]),
    "a",
  );
  assert.equal(sessionNameForOnu(onu, [s("a", "d0-5f-af-d3-c7-1e")]), "a");
  assert.equal(sessionNameForOnu(onu, [s("a", "D0:5F:AF:D3:C7:1D")]), null); // selisih 0
  assert.equal(sessionNameForOnu(onu, [s("a", "D0:5F:AF:D3:C7:21")]), null); // selisih 4
  assert.equal(sessionNameForOnu(onu, [s("a", "D0:5F:AF:D3:C8:00")]), null); // oktet kelima beda
  assert.equal(
    sessionNameForOnu(onu, [
      s("a", "D0:5F:AF:D3:C7:1E"),
      s("b", "D0:5F:AF:D3:C7:1F"),
    ]),
    null,
  ); // ambigu
  assert.equal(sessionNameForOnu(onu, [s("a", "D0:5F:AF:D3:C7:1C")]), null); // caller-id lebih kecil dari MAC ONU
  assert.equal(sessionNameForOnu(onu, [s("a", "11:22:33:44:C7:1F")]), null); // hanya oktet terakhir mirip
  assert.equal(sessionNameForOnu(onu, [s("a", "D0:5F:AF:D3:C7:1F", "")]), null); // tanpa alamat
  assert.equal(
    sessionNameForOnu("bukan-mac", [s("a", "D0:5F:AF:D3:C7:1F")]),
    null,
  );
});

test("kode yang bertentangan dengan nomor PPPoE membatalkan kecocokan nama tanpa kode", () => {
  const cs = [
    { id: "1", name: "RATIMIN", pppoeUsername: "17060001834@runsnet.id" },
  ];
  assert.deepEqual(m({ description: "1121-RATIMIN" }, cs), {
    status: "unmatched",
  });
  assert.deepEqual(m({ description: "1834-RATIMIN" }, cs), {
    status: "exact_name",
    customerId: "1",
  });
});
