import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { SETUP_DATA_SOURCE_REGISTRY, SETUP_PAGE_TIPS, evaluateSetupProgress } =
  await import("../src/lib/dashboard/setup-extended.ts");
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("registry: modul dummy dengan envKey valid", () => {
  assert.equal(SETUP_DATA_SOURCE_REGISTRY.length, 21);
  for (const e of SETUP_DATA_SOURCE_REGISTRY) {
    assert.equal(e.status, "dummy");
    assert.match(e.envKey, /^[A-Z][A-Z0-9_]+$/);
    assert.match(e.notes, /Fase 5/);
  }
  assert.deepEqual(
    SETUP_DATA_SOURCE_REGISTRY.map((e) => e.module),
    [
      "Router MikroTik",
      "OLT HSGQ",
      "GenieACS NBI",
      "Billing Scraper",
      "Papan Metrik Dashboard",
      "Papan Alert Gangguan",
      "Log Notifikasi WhatsApp",
      "Ringkasan Jaringan & Router",
      "Port PON & Daftar ONU",
      "Sampel Trafik & Tren Bandwidth",
      "Papan NetFlow & Aliran Trafik",
      "Deteksi Anomali Jaringan",
      "Jejak Aktivitas & Log Audit",
      "Ekspor Data & Laporan",
      "Riwayat Migrasi Skema",
      "Sinkronisasi Data Otomatis",
      "Ringkasan Seed Data Awal",
      "Transfer Data Lokal ke Server",
      "Status Penyelarasan Otomatis",
      "Riwayat Sinkronisasi Data",
      "Pengaman Deploy & Kesiapan Produksi",
    ],
  );
});

test("evaluateSetupProgress: gerbang butuh router aktif", () => {
  const none = evaluateSetupProgress([
    { kind: "olt", status: "aktif" },
    { kind: "router", status: "nonaktif" },
  ]);
  assert.equal(none.isGatePassed, false);
  assert.equal(none.routerConfigured, false);
  assert.equal(none.oltConfigured, true);
  assert.equal(none.optionalCount, 1);
  assert.ok(none.pendingNotice);

  const ok = evaluateSetupProgress([{ kind: "router", status: "aktif" }]);
  assert.equal(ok.isGatePassed, true);
  assert.equal(ok.pendingNotice, null);
  assert.equal(ok.optionalCount, 0);
});

test("SETUP_PAGE_TIPS: cara kerja, masalah umum, solusi", () => {
  const ids = SETUP_PAGE_TIPS.map((g) => g.id);
  assert.deepEqual(ids, ["cara-kerja", "masalah-umum", "solusi"]);
  const masalah = SETUP_PAGE_TIPS[1].items.map((i) => i.title).join("|");
  assert.match(masalah, /Timeout/);
  assert.match(masalah, /autentikasi/);
  assert.match(masalah, /simulator/);
  for (const g of SETUP_PAGE_TIPS) assert.ok(g.items.length > 0);
});

test("komponen diekspor dan page memuatnya", () => {
  const tips = read("../src/components/dashboard/setup-tips-panel.tsx");
  const reg = read("../src/components/dashboard/mock-registry-card.tsx");
  assert.match(tips, /export function SetupTipsPanel/);
  assert.match(tips, /data-testid="setup-tips-panel"/);
  assert.match(reg, /export function MockRegistryCard/);
  assert.match(reg, /data-testid="mock-registry-card"/);
  assert.match(reg, /Data Tiruan \(Mock\)/);
  const page = read("../src/app/(protected)/setup/page.tsx");
  assert.match(page, /<SetupTipsPanel/);
  assert.match(page, /<MockRegistryCard/);
});
