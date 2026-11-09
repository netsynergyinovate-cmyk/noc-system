import { z } from "zod";

export type TransferConflictStrategy = "upsert" | "skip_existing" | "overwrite";

export interface TransferConnectionConfig {
  sourceDatabaseUrl: string;
  sourceMaskedUrl: string;
  targetDatabaseUrl: string | null;
  targetMaskedUrl: string | null;
  isConfigured: boolean;
  batchSize: number;
  conflictStrategy: TransferConflictStrategy;
  isDryRun: boolean;
  timeoutMs: number;
  autoAlignmentEnabled: boolean;
  autoSeedEnabled: boolean;
}

export function maskDatabaseUrl(urlStr: string | null | undefined): string {
  if (!urlStr || typeof urlStr !== "string" || urlStr.trim() === "") {
    return "-";
  }

  try {
    const parsed = new URL(urlStr);
    const user = parsed.username ? `${parsed.username}:***@` : "";
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${user}${parsed.hostname}${port}${parsed.pathname}`;
  } catch {
    return "postgresql://***:***@masked-host/db";
  }
}

export function validatePostgresUrl(
  value: string | undefined | null,
  fieldName: string,
): {
  valid: boolean;
  error?: string;
} {
  if (!value || typeof value !== "string" || value.trim() === "") {
    return { valid: false, error: `${fieldName} wajib diisi` };
  }

  try {
    const url = new URL(value);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) {
      return {
        valid: false,
        error: `${fieldName} harus memiliki protokol postgres: atau postgresql:`,
      };
    }
    if (!url.hostname) {
      return {
        valid: false,
        error: `${fieldName} harus memiliki hostname yang valid`,
      };
    }
    if (url.pathname.length <= 1) {
      return {
        valid: false,
        error: `${fieldName} harus menyertakan nama database`,
      };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: `${fieldName} format URL tidak valid` };
  }
}

const transferEnvSchema = z.object({
  SOURCE_DATABASE_URL: z.string().optional(),
  TARGET_DATABASE_URL: z.string().optional(),
  TRANSFER_BATCH_SIZE: z.coerce.number().int().min(10).max(5000).default(500),
  TRANSFER_CONFLICT_STRATEGY: z
    .enum(["upsert", "skip_existing", "overwrite"])
    .default("upsert"),
  TRANSFER_DRY_RUN: z
    .preprocess((v) => v === "true" || v === true, z.boolean())
    .default(false),
  TRANSFER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(300000)
    .default(30000),
  AUTO_ALIGNMENT_ENABLED: z
    .preprocess((v) => v !== "false" && v !== false, z.boolean())
    .default(true),
  AUTO_SEED: z
    .preprocess((v) => v !== "false" && v !== false, z.boolean())
    .default(true),
});

/**
 * Membaca konfigurasi koneksi sumber dan target transfer database dari environment variables.
 */
export function getTransferConnectionConfig(
  env: NodeJS.ProcessEnv = process.env,
): TransferConnectionConfig {
  const parsed = transferEnvSchema.parse(env);
  const sourceRaw =
    env.SOURCE_DATABASE_URL?.trim() || env.DATABASE_URL?.trim() || "";
  const targetRaw = env.TARGET_DATABASE_URL?.trim() || "";

  const isTargetValid =
    targetRaw.length > 0 &&
    validatePostgresUrl(targetRaw, "TARGET_DATABASE_URL").valid;

  return {
    sourceDatabaseUrl: sourceRaw,
    sourceMaskedUrl: maskDatabaseUrl(sourceRaw),
    targetDatabaseUrl: isTargetValid ? targetRaw : null,
    targetMaskedUrl: isTargetValid ? maskDatabaseUrl(targetRaw) : null,
    isConfigured: sourceRaw.length > 0 && isTargetValid,
    batchSize: parsed.TRANSFER_BATCH_SIZE,
    conflictStrategy: parsed.TRANSFER_CONFLICT_STRATEGY,
    isDryRun: parsed.TRANSFER_DRY_RUN,
    timeoutMs: parsed.TRANSFER_TIMEOUT_MS,
    autoAlignmentEnabled: parsed.AUTO_ALIGNMENT_ENABLED,
    autoSeedEnabled: parsed.AUTO_SEED,
  };
}
