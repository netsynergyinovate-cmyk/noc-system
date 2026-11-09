import "server-only";
import { runAllInitialSeeds, type SeedRunReport } from "./seed-data.service";

export interface StartupSeedOptions {
  autoSeed?: boolean;
  logger?: (line: string) => void;
}

export interface StartupSeedResult {
  executed: boolean;
  skippedReason?: string;
  success: boolean;
  report?: SeedRunReport;
  error?: string;
}

/**
 * Menentukan apakah seed startup harus dijalankan.
 * Dinonaktifkan saat build Next.js (phase-production-build) atau jika AUTO_SEED=false / SKIP_STARTUP_SEED=true.
 */
export function shouldRunStartupSeed(env: NodeJS.ProcessEnv = process.env): {
  shouldRun: boolean;
  reason?: string;
} {
  if (env.NEXT_PHASE === "phase-production-build") {
    return { shouldRun: false, reason: "Next.js phase-production-build aktif" };
  }

  if (env.SKIP_STARTUP_SEED === "true") {
    return { shouldRun: false, reason: "SKIP_STARTUP_SEED=true" };
  }

  if (env.AUTO_SEED === "false") {
    return { shouldRun: false, reason: "AUTO_SEED=false" };
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
 * Menjalankan seed data awal saat aplikasi pertama start / startup sebelum request dilayani.
 */
export async function runStartupSeed(
  options: StartupSeedOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<StartupSeedResult> {
  const log = options.logger ?? ((line: string) => console.log(line));
  const check = shouldRunStartupSeed(env);

  if (!check.shouldRun) {
    log(`[SEED] Dilewati: ${check.reason}`);
    return {
      executed: false,
      skippedReason: check.reason,
      success: true,
    };
  }

  log("[SEED] Memeriksa dan menjalankan penyemaian data awal (idempoten)...");

  try {
    const report = await runAllInitialSeeds("startup_bootstrap");

    log(
      `[SEED] Selesai: ${report.newlySeededCount} disemai, ${report.alreadySeededCount} sudah ada (${report.totalCategories} kategori).`,
    );

    return {
      executed: true,
      success: true,
      report,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`[SEED][ERROR] Gagal menyemai data awal saat startup: ${message}`);
    return {
      executed: true,
      success: false,
      error: message,
    };
  }
}
