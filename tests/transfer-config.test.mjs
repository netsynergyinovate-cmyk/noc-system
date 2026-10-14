import test from "node:test";
import assert from "node:assert/strict";

const {
  maskDatabaseUrl,
  validatePostgresUrl,
  getTransferConnectionConfig,
} = await import("../src/lib/transfer-config.ts");

test("maskDatabaseUrl menyamarkan kata sandi dalam connection string", () => {
  const url = "postgresql://myuser:supersecret123@myhost.isp.net:5432/noc_prod";
  const masked = maskDatabaseUrl(url);

  assert.equal(masked.includes("supersecret123"), false);
  assert.equal(masked, "postgresql://myuser:***@myhost.isp.net:5432/noc_prod");
});

test("maskDatabaseUrl menangani nilai kosong atau null dengan anggun", () => {
  assert.equal(maskDatabaseUrl(""), "-");
  assert.equal(maskDatabaseUrl(null), "-");
  assert.equal(maskDatabaseUrl(undefined), "-");
});

test("validatePostgresUrl memvalidasi format dan protokol PostgreSQL", () => {
  const valid = validatePostgresUrl(
    "postgres://postgres:pwd@127.0.0.1:5432/noc_db",
    "TEST_URL",
  );
  assert.equal(valid.valid, true);

  const invalidProto = validatePostgresUrl(
    "http://localhost:5432/noc_db",
    "TEST_URL",
  );
  assert.equal(invalidProto.valid, false);
  assert.match(invalidProto.error, /protokol postgres/);

  const noDb = validatePostgresUrl("postgres://localhost:5432", "TEST_URL");
  assert.equal(noDb.valid, false);
  assert.match(noDb.error, /nama database/);
});

test("getTransferConnectionConfig membaca nilai default dan opsi kustom dari env", () => {
  const cfg = getTransferConnectionConfig({
    DATABASE_URL: "postgresql://dev_user:devpass@localhost:5432/noc_dev",
    TARGET_DATABASE_URL:
      "postgresql://prod_user:prodpass@server.isp.net:5432/noc_prod",
    TRANSFER_BATCH_SIZE: "250",
    TRANSFER_CONFLICT_STRATEGY: "overwrite",
    TRANSFER_DRY_RUN: "true",
  });

  assert.equal(cfg.isConfigured, true);
  assert.equal(cfg.batchSize, 250);
  assert.equal(cfg.conflictStrategy, "overwrite");
  assert.equal(cfg.isDryRun, true);
  assert.equal(
    cfg.sourceMaskedUrl,
    "postgresql://dev_user:***@localhost:5432/noc_dev",
  );
  assert.equal(
    cfg.targetMaskedUrl,
    "postgresql://prod_user:***@server.isp.net:5432/noc_prod",
  );
});

test("getTransferConnectionConfig menandai isConfigured: false jika TARGET_DATABASE_URL tidak diset", () => {
  const cfg = getTransferConnectionConfig({
    DATABASE_URL: "postgresql://dev_user:devpass@localhost:5432/noc_dev",
  });

  assert.equal(cfg.isConfigured, false);
  assert.equal(cfg.targetDatabaseUrl, null);
  assert.equal(cfg.targetMaskedUrl, null);
  assert.equal(cfg.batchSize, 500); // default
  assert.equal(cfg.conflictStrategy, "upsert"); // default
});
