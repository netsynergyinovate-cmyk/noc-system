import test from "node:test";
import assert from "node:assert/strict";
import {
  DEVICE_KINDS,
  REQUIRED_ENV,
  evaluateDeviceEnv,
  loadDeviceEnvStatuses,
} from "../src/lib/device-env-loader.ts";

const full = {
  MIKROTIK_REST_HOST: "10.0.0.1",
  MIKROTIK_REST_USER: "u",
  MIKROTIK_REST_PASSWORD: "p",
  OLT_HSGQ_HOST: "10.0.1.1",
  OLT_HSGQ_USER: "u",
  OLT_HSGQ_PASSWORD: "p",
  GENIEACS_NBI_URL: "http://10.0.2.1:7557",
  BILLING_URL: "https://billing.example",
  BILLING_USERNAME: "u",
  BILLING_PASSWORD: "p",
};

test("env kosong: semua perangkat belum_siap dengan daftar variabel kurang", () => {
  const all = loadDeviceEnvStatuses({});
  for (const kind of DEVICE_KINDS) {
    assert.equal(all[kind].status, "belum_siap");
    assert.deepEqual(all[kind].missing, [...REQUIRED_ENV[kind]]);
  }
});

test("env lengkap: semua perangkat siap tanpa variabel kurang", () => {
  const all = loadDeviceEnvStatuses(full);
  for (const kind of DEVICE_KINDS) {
    assert.deepEqual(all[kind], { kind, status: "siap", missing: [] });
  }
});

test("nilai kosong/spasi dianggap belum diisi; hanya yang kurang dilaporkan", () => {
  const s = evaluateDeviceEnv("mikrotik", {
    ...full,
    MIKROTIK_REST_USER: "",
    MIKROTIK_REST_PASSWORD: "   ",
  });
  assert.equal(s.status, "belum_siap");
  assert.deepEqual(s.missing, ["MIKROTIK_REST_USER", "MIKROTIK_REST_PASSWORD"]);
});

test("satu perangkat siap tidak mempengaruhi yang lain", () => {
  const all = loadDeviceEnvStatuses({ GENIEACS_NBI_URL: "http://x:7557" });
  assert.equal(all.genieacs.status, "siap");
  assert.equal(all.billing.status, "belum_siap");
});
