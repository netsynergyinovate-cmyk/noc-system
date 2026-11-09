import "server-only";
import {
  applyUpgradeMigrationsIfNeeded,
  type AppUpgradeMigrationReport,
  type MigrationRunnerResult,
} from "./schema-migration-runner.service";

export interface StartupMigrationOptions {
  autoMigrate?: boolean;
  strict?: boolean;
  logger?: (line: string) => void;
  migrationsFolder?: string;
  appVersion?: string;
}

export interface StartupMigrationResult {
  executed: boolean;
  skippedReason?: string;
  success: boolean;
  runnerResult?: MigrationRunnerResult;
  upgradeReport?: AppUpgradeMigrationReport;
  error?: string;
}

/**
 * Menentukan apakah migrasi startup harus dijalankan.
 * Dinonaktifkan saat build Next.js (phase-production-build) atau jika AUTO_MIGRATE=false.
 */
export function shouldRunStartupMigration(
  env: NodeJS.ProcessEnv = process.env,
): { shouldRun: boolean; reason?: string } {
  if (env.NEXT_PHASE === "phase-production-build") {
    return { shouldRun: false, reason: "Next.js phase-production-build aktif" };
  }

  if (env.SKIP_STARTUP_MIGRATION === "true") {
    return { shouldRun: false, reason: "SKIP_STARTUP_MIGRATION=true" };
  }

  if (env.AUTO_MIGRATE === "false") {
    return { shouldRun: false, reason: "AUTO_MIGRATE=false" };
  }

  const dbUrl = env.DATABASE_URL?.trim();
  if (!dbUrl) {
    return { shouldRun: false, reason: "DATABASE_URL kosong" };
  }

  try {
    const proto = new URL(dbUrl).protocol;
    if (!["postgres:", "postgresql:"].includes(proto)) {
      return { shouldRun: false, reason: "DATABASE_URL bukan PostgreSQL" };
    }
  } catch {
    return { shouldRun: false, reason: "DATABASE_URL tidak valid" };
  }

  return { shouldRun: true };
}

/**
 * Menjalankan migrasi skema saat startup aplikasi sebelum request dilayani.
 */
export async function runStartupMigrations(
  options: StartupMigrationOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<StartupMigrationResult> {
  const log = options.logger ?? ((line: string) => console.log(line));
  const check = shouldRunStartupMigration(env);

  if (!check.shouldRun) {
    log(`[MIGRASI STARTUP] Dilewati: ${check.reason}`);
    return {
      executed: false,
      skippedReason: check.reason,
      success: true,
    };
  }

  const strict =
    options.strict ??
    (env.NODE_ENV === "production" && env.STRICT_STARTUP !== "false");

  log(
    "[MIGRASI STARTUP] Memeriksa versi dan menerapkan skema sebelum melayani request...",
  );

  try {
    const upgradeReport = await applyUpgradeMigrationsIfNeeded(undefined, {
      migrationsFolder: options.migrationsFolder,
      appVersion: options.appVersion,
      timescale: true,
      retentionDays: env.TRAFFIC_RETENTION_DAYS,
      logger: log,
    });

    if (upgradeReport.migrationsApplied.length > 0) {
      log(
        `[MIGRASI STARTUP SUKSES] Berhasil menerapkan ${upgradeReport.migrationsApplied.length} migrasi (${upgradeReport.durationMs}ms)`,
      );
    } else {
      log(
        `[MIGRASI STARTUP OK] Skema database sudah up-to-date (${upgradeReport.durationMs}ms)`,
      );
    }

    return {
      executed: true,
      success: true,
      upgradeReport,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`[FATAL] Migrasi skema saat startup gagal: ${errorMsg}`);

    if (strict) {
      console.error(
        "[FATAL] Server menolak melayani permintaan karena migrasi skema gagal:",
        errorMsg,
      );
      process.exit(1);
    }

    return {
      executed: true,
      success: false,
      error: errorMsg,
    };
  }
}
