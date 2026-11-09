import test from "node:test";
import assert from "node:assert/strict";

const {
  OPTIONAL_INTEGRATION_TEMPLATES,
  OPTIONAL_INTEGRATIONS_MOCK_ENTRY,
  evaluateOptionalIntegrations,
} = await import("../src/lib/dashboard/optional-integrations.ts");

test("OPTIONAL_INTEGRATION_TEMPLATES memuat seluruh modul integrasi penting", () => {
  assert.ok(OPTIONAL_INTEGRATION_TEMPLATES.length >= 5);
  const ids = OPTIONAL_INTEGRATION_TEMPLATES.map((t) => t.id);
  assert.ok(ids.includes("opt-olt-hsgq"));
  assert.ok(ids.includes("opt-genieacs-nbi"));
  assert.ok(ids.includes("opt-netflow-collector"));
  assert.ok(ids.includes("opt-whatsapp-gateway"));
  assert.ok(ids.includes("opt-billing-sync"));
});

test("evaluateOptionalIntegrations mendeteksi modul belum terkonfigurasi pada env kosong", () => {
  const overview = evaluateOptionalIntegrations({});
  assert.equal(overview.total, OPTIONAL_INTEGRATION_TEMPLATES.length);
  assert.equal(overview.configuredCount, 0);
  assert.equal(
    overview.unconfiguredCount,
    OPTIONAL_INTEGRATION_TEMPLATES.length,
  );
  assert.equal(overview.completionPercentage, 0);
});

test("evaluateOptionalIntegrations mendeteksi modul terkonfigurasi jika env lengkap", () => {
  const fullEnv = {
    OLT_HSGQ_HOST: "192.168.10.1",
    OLT_HSGQ_USER: "admin",
    OLT_HSGQ_PASSWORD: "secretpassword",
    NETFLOW_COLLECTOR_HOST: "127.0.0.1",
  };
  const overview = evaluateOptionalIntegrations(fullEnv);
  assert.ok(overview.configuredCount >= 2);
  const olt = overview.items.find((i) => i.id === "opt-olt-hsgq");
  assert.equal(olt?.status, "terkonfigurasi");
});

test("evaluateOptionalIntegrations menghormati custom override state", () => {
  const customStates = {
    "opt-whatsapp-gateway": "terkonfigurasi",
    "opt-billing-sync": "dalam-pengujian",
  };
  const overview = evaluateOptionalIntegrations({}, customStates);
  const wa = overview.items.find((i) => i.id === "opt-whatsapp-gateway");
  const billing = overview.items.find((i) => i.id === "opt-billing-sync");
  assert.equal(wa?.status, "terkonfigurasi");
  assert.equal(billing?.status, "dalam-pengujian");
});

test("OPTIONAL_INTEGRATIONS_MOCK_ENTRY terdaftar dalam registry dummy", () => {
  assert.equal(OPTIONAL_INTEGRATIONS_MOCK_ENTRY.status, "dummy");
  assert.ok(
    OPTIONAL_INTEGRATIONS_MOCK_ENTRY.readPath.includes("optional-integrations"),
  );
});
