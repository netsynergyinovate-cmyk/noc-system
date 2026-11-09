import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

const require = createRequire(import.meta.url);
try {
  const so = require.resolve("server-only");
  require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };
} catch {}

register();

const {
  createFeatureMarkerSchema,
  updateFeatureMarkerSchema,
  listFeatureMarkersSchema,
  featureMarkerIdSchema,
  FEATURE_MARKER_CATEGORIES,
  FEATURE_MARKER_FREQUENCIES,
  FEATURE_MARKER_STATUSES,
} = await import("../src/validators/feature-markers.ts");

const { isDeveloper, isSuperAdmin, isAdmin, isUser } =
  await import("../src/lib/roles.ts");

const { evaluateDeployAccess } =
  await import("../src/lib/deploy/role-guard.ts");

const { capabilities } = await import("../src/lib/access.ts");
const { generateTechnicalReport } =
  await import("../src/lib/deploy/feature-diagnostic-engine.ts");

test("Validasi createFeatureMarkerSchema menerima payload valid dan memberi bawaan", () => {
  const parsed = createFeatureMarkerSchema.parse({
    pagePath: "/app/pelanggan",
    featureName: "Tombol Tambah Pelanggan",
  });

  assert.equal(parsed.pagePath, "/app/pelanggan");
  assert.equal(parsed.featureName, "Tombol Tambah Pelanggan");
  assert.equal(parsed.category, "used_frequently");
  assert.equal(parsed.frequency, "daily");
  assert.equal(parsed.notes, "");
  assert.equal(parsed.elementSelector, "");
  assert.equal(parsed.elementText, "");
});

test("Validasi createFeatureMarkerSchema menolak jika pagePath atau featureName kosong", () => {
  assert.throws(() => {
    createFeatureMarkerSchema.parse({
      pagePath: "",
      featureName: "Tes",
    });
  });

  assert.throws(() => {
    createFeatureMarkerSchema.parse({
      pagePath: "/app",
      featureName: "   ",
    });
  });
});

test("Validasi createFeatureMarkerSchema menerima kategori dan frekuensi yang ditentukan", () => {
  for (const cat of FEATURE_MARKER_CATEGORIES) {
    for (const freq of FEATURE_MARKER_FREQUENCIES) {
      const parsed = createFeatureMarkerSchema.parse({
        pagePath: "/app/router",
        featureName: "Metrik CPU",
        category: cat,
        frequency: freq,
        notes: "Uji kategori",
      });
      assert.equal(parsed.category, cat);
      assert.equal(parsed.frequency, freq);
    }
  }
});

test("Validasi updateFeatureMarkerSchema menerima status atau developerNotes", () => {
  for (const status of FEATURE_MARKER_STATUSES) {
    const parsed = updateFeatureMarkerSchema.parse({ status });
    assert.equal(parsed.status, status);
  }

  const withNotes = updateFeatureMarkerSchema.parse({
    developerNotes: "Akan diperbaiki di sprint berikutnya.",
  });
  assert.equal(
    withNotes.developerNotes,
    "Akan diperbaiki di sprint berikutnya.",
  );

  // Harus melempar jika keduanya tidak disediakan
  assert.throws(() => {
    updateFeatureMarkerSchema.parse({});
  });
});

test("Validasi featureMarkerIdSchema memeriksa format UUID", () => {
  assert.equal(
    featureMarkerIdSchema.parse("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"),
    "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  );

  assert.throws(() => {
    featureMarkerIdSchema.parse("invalid-id-123");
  });
});

test("Validasi listFeatureMarkersSchema menetapkan pagination default yang aman", () => {
  const empty = listFeatureMarkersSchema.parse({});
  assert.equal(empty.limit, 50);
  assert.equal(empty.offset, 0);

  const custom = listFeatureMarkersSchema.parse({
    limit: "100",
    offset: "20",
    category: "bug_issue",
    search: "isolir",
  });
  assert.equal(custom.limit, 100);
  assert.equal(custom.offset, 20);
  assert.equal(custom.category, "bug_issue");
  assert.equal(custom.search, "isolir");
});

test("Pemeriksaan Peran (isDeveloper, isSuperAdmin, isAdmin, isUser) akurat", () => {
  assert.ok(isDeveloper("developer"));
  assert.ok(isDeveloper("superadmin,developer"));
  assert.ok(!isDeveloper("user"));
  assert.ok(!isDeveloper("admin"));

  assert.ok(isSuperAdmin("superadmin"));
  assert.ok(!isSuperAdmin("admin"));
  assert.ok(!isSuperAdmin("user"));

  assert.ok(isAdmin("admin"));
  assert.ok(isAdmin("superadmin"));
  assert.ok(!isAdmin("user"));

  assert.ok(isUser("user"));
  assert.ok(!isUser("admin"));
  assert.ok(!isUser("developer"));
  assert.ok(!isUser("superadmin"));
});

test("Kemampuan manageDeploy didefinisikan dengan izin deploy:manage di access.ts", () => {
  assert.ok(
    capabilities.manageDeploy,
    "manageDeploy capability harus terdaftar",
  );
  assert.deepEqual(capabilities.manageDeploy, { deploy: ["manage"] });
});

test("evaluateDeployAccess mengizinkan peran developer dan menolak peran user", () => {
  const req = new Request("https://noc.example.com/app/deploy", {
    headers: { host: "noc.example.com" },
  });

  // Akses oleh developer harus diizinkan
  const devGuard = evaluateDeployAccess(req, "developer");
  assert.equal(devGuard.allowed, true);
  assert.equal(devGuard.status, 200);

  // Akses oleh user biasa harus ditolak
  const userGuard = evaluateDeployAccess(req, "user");
  assert.equal(userGuard.allowed, false);
});

test("generateTechnicalReport memetakan file, endpoint API, fungsi runtime dan checklist cara perbaikan", () => {
  const report = generateTechnicalReport({
    id: "test-marker-1",
    featureName: "[Pop-up: Pengaturan Perangkat Pelanggan] Tombol Reboot CPE",
    category: "bug_issue",
    frequency: "daily",
    status: "baru",
    pagePath: "/app/pelanggan",
    notes: "Tombol ini macet saat diklik",
    elementSelector: "button#reboot-cpe.bg-destructive",
  });

  assert.equal(
    report.sourceMap.pageFile,
    "src/app/(protected)/app/pelanggan/page.tsx",
  );
  assert.ok(
    report.sourceMap.componentFiles.some((f) =>
      f.includes("customer-cpe-dialog.tsx"),
    ),
    "Harus memetakan komponen customer-cpe-dialog.tsx",
  );
  assert.ok(
    report.sourceMap.apiEndpoints.some((api) => api.includes("/cpe")),
    "Harus memetakan endpoint API /cpe",
  );
  assert.ok(
    report.runtimeFunctionSummary.includes("createCpeTask"),
    "Harus mengenali fungsi runtime createCpeTask",
  );
  assert.ok(report.context.isInsideModal, "Harus mengenali konteks modal");
  assert.equal(report.context.modalName, "Pengaturan Perangkat Pelanggan");
  assert.ok(
    report.remediationChecklist.length >= 4,
    "Harus menyediakan 4 langkah checklist investigasi",
  );
  assert.ok(
    report.troubleshootingGuidance.length >= 1,
    "Harus menyediakan panduan troubleshooting",
  );
});

test("Berkas API dan Komponen Telemetri Tanda Fitur Terdefinisi", () => {
  const requiredFiles = [
    "src/db/schema/feature-markers.ts",
    "drizzle/0043_feature_markers.sql",
    "src/validators/feature-markers.ts",
    "src/services/feature-markers.service.ts",
    "src/app/api/feature-markers/route.ts",
    "src/app/api/feature-markers/[id]/route.ts",
    "src/app/api/deploy/feature-markers/route.ts",
    "src/components/dashboard/feature-marker-inspector.tsx",
    "src/components/dashboard/deploy-user-markers-tab.tsx",
  ];

  for (const relPath of requiredFiles) {
    const fullPath = path.resolve(relPath);
    assert.ok(fs.existsSync(fullPath), `Berkas ${relPath} wajib ada`);
  }
});
