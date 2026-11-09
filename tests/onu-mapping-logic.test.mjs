import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clearOnuMappings,
  getMappedCustomerForOnu,
  getOnuMappings,
  saveOnuMapping,
  suggestAutoMapping,
  validateMappingPair,
  ONU_MAPPING_STORAGE_KEY,
} from "../src/lib/dashboard/onu-mapping-logic.ts";

function installLocalStorage() {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
  };
  return data;
}

test("memori: simpan, baca, lepas, bersihkan", () => {
  delete globalThis.localStorage;
  clearOnuMappings();
  const a = saveOnuMapping("onu-001", "c1", "budi");
  assert.equal(a.onuId, "onu-001");
  assert.equal(a.mappedBy, "budi");
  assert.equal(getMappedCustomerForOnu("onu-001"), "c1");
  assert.deepEqual(getOnuMappings(), { "onu-001": "c1" });
  saveOnuMapping("onu-001", null, "budi");
  assert.equal(getMappedCustomerForOnu("onu-001"), null);
  clearOnuMappings();
  assert.deepEqual(getOnuMappings(), {});
});

test("localStorage: tersimpan di key onu_customer_mappings", () => {
  const data = installLocalStorage();
  try {
    clearOnuMappings();
    saveOnuMapping("onu-002", "c2", "ani");
    assert.ok(data.has(ONU_MAPPING_STORAGE_KEY));
    assert.equal(ONU_MAPPING_STORAGE_KEY, "onu_customer_mappings");
    assert.equal(getMappedCustomerForOnu("onu-002"), "c2");
    clearOnuMappings();
    assert.equal(data.has(ONU_MAPPING_STORAGE_KEY), false);
  } finally {
    delete globalThis.localStorage;
  }
});

test("localStorage rusak diabaikan", () => {
  const data = installLocalStorage();
  try {
    data.set(ONU_MAPPING_STORAGE_KEY, "{bukan json");
    assert.deepEqual(getOnuMappings(), {});
    data.set(ONU_MAPPING_STORAGE_KEY, "[1,2]");
    assert.deepEqual(getOnuMappings(), {});
  } finally {
    delete globalThis.localStorage;
  }
});

test("satu pelanggan hanya satu ONU", () => {
  delete globalThis.localStorage;
  clearOnuMappings();
  saveOnuMapping("onu-1", "c1", "x");
  saveOnuMapping("onu-2", "c1", "x");
  assert.equal(getMappedCustomerForOnu("onu-1"), null);
  assert.equal(getMappedCustomerForOnu("onu-2"), "c1");
  clearOnuMappings();
});

test("validateMappingPair", () => {
  assert.equal(validateMappingPair("", "c1").valid, false);
  assert.equal(validateMappingPair("  ", null).valid, false);
  assert.equal(validateMappingPair("onu-1", "").valid, false);
  assert.equal(validateMappingPair("onu-1", null).valid, true);
  assert.equal(validateMappingPair("onu-1", "c1").valid, true);
  assert.throws(() => saveOnuMapping("", "c1", "x"));
});

const onu = (over) => ({
  onuId: "o1",
  serialNumber: "ZTEGC12345678",
  oltName: "OLT-1",
  ponPort: "PON 1/1/1:1",
  rxPowerDbm: -20,
  currentCustomerId: null,
  ...over,
});
const cust = (over) => ({
  id: "c1",
  name: "Orang Lain",
  pppoeUsername: "x@noc",
  address: "Jl. A",
  ...over,
});

test("suggestAutoMapping: high pada username di serial", () => {
  const r = suggestAutoMapping(
    [onu({ serialNumber: "ZTEGC-budi0001" })],
    [cust({ id: "c9", pppoeUsername: "budi0001@noc" })],
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].confidence, "high");
  assert.equal(r[0].customerId, "c9");
});

test("suggestAutoMapping: medium pada nama mirip", () => {
  const r = suggestAutoMapping(
    [onu({ currentCustomerName: "Budi Santoso" })],
    [cust({ id: "c2", name: "Budi Santoso Jaya" })],
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].confidence, "medium");
});

test("suggestAutoMapping: abaikan yang sudah terpetakan, tanpa duplikat, tanpa kecocokan", () => {
  assert.deepEqual(
    suggestAutoMapping(
      [onu({ currentCustomerId: "c1", serialNumber: "budi0001" })],
      [cust({ pppoeUsername: "budi0001@noc" })],
    ),
    [],
  );
  assert.deepEqual(
    suggestAutoMapping(
      [onu()],
      [cust({ assignedOnuId: "o9", pppoeUsername: "budi0001@noc" })],
    ),
    [],
  );
  assert.deepEqual(suggestAutoMapping([onu()], [cust()]), []);
  const r = suggestAutoMapping(
    [
      onu({ onuId: "a", serialNumber: "budi0001" }),
      onu({ onuId: "b", serialNumber: "budi0001" }),
    ],
    [cust({ pppoeUsername: "budi0001@noc" })],
  );
  assert.equal(r.length, 1);
});

test("komponen panel diekspor dan terpasang di halaman CPE", () => {
  const panel = readFileSync(
    "src/components/dashboard/onu-customer-mapping-panel.tsx",
    "utf8",
  );
  assert.match(panel, /export function OnuCustomerMappingPanel/);
  assert.match(panel, /data-testid="onu-mapping-panel"/);
  assert.match(panel, /data-testid="onu-mapping-mock-badge"/);
  assert.match(panel, /data-testid="save-mapping-btn"/);
  assert.match(
    panel,
    /Pemetaan Tiruan \(Fase 2\) · Wajib sinkronisasi DB di Fase 5/,
  );
  const board = readFileSync("src/components/dashboard/cpe-board.tsx", "utf8");
  assert.match(board, /<OnuCustomerMappingPanel \/>/);
  assert.match(board, /Kelola Pemetaan ONU/);
});
