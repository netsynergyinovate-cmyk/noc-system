import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "tsx/esm/api";

register();

const { onboardingSteps, onboardingProgress } =
  await import("../src/db/schema/onboarding.ts");

test("onboardingSteps skema terdefinisi dengan kolom yang sesuai", () => {
  assert.ok(onboardingSteps);
  const cols = Object.keys(onboardingSteps);
  assert.ok(cols.includes("id"));
  assert.ok(cols.includes("stepNumber"));
  assert.ok(cols.includes("type"));
  assert.ok(cols.includes("title"));
  assert.ok(cols.includes("description"));
  assert.ok(cols.includes("targetUrl"));
  assert.ok(cols.includes("targetLabel"));
  assert.ok(cols.includes("prerequisiteStepIds"));
  assert.ok(cols.includes("estimatedMinutes"));
  assert.ok(cols.includes("createdAt"));
});

test("onboardingProgress skema terdefinisi dengan foreign key dan kolom status", () => {
  assert.ok(onboardingProgress);
  const cols = Object.keys(onboardingProgress);
  assert.ok(cols.includes("id"));
  assert.ok(cols.includes("stepId"));
  assert.ok(cols.includes("userId"));
  assert.ok(cols.includes("status"));
  assert.ok(cols.includes("completedAt"));
  assert.ok(cols.includes("notes"));
  assert.ok(cols.includes("createdAt"));
  assert.ok(cols.includes("updatedAt"));
});

test("Berkas migrasi SQL onboarding_steps dan onboarding_progress tersedia", () => {
  const drizzleDir = path.resolve("drizzle");
  const files = fs.readdirSync(drizzleDir).filter((f) => f.endsWith(".sql"));
  // Tabel onboarding dibuat oleh salah satu migrasi (bukan harus yang terakhir:
  // migrasi sesudahnya boleh mengubah tabel lain).
  const sql = files
    .map((f) => fs.readFileSync(path.join(drizzleDir, f), "utf-8"))
    .join("\n");

  assert.ok(
    sql.includes('CREATE TABLE "onboarding_steps"') ||
      sql.includes('CREATE TABLE IF NOT EXISTS "onboarding_steps"'),
    "Harus membuat tabel onboarding_steps",
  );
  assert.ok(
    sql.includes('CREATE TABLE "onboarding_progress"') ||
      sql.includes('CREATE TABLE IF NOT EXISTS "onboarding_progress"'),
    "Harus membuat tabel onboarding_progress",
  );
  assert.ok(sql.includes("onboarding_progress_user_step_idx"));
});
