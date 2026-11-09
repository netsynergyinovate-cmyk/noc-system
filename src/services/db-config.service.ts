import "server-only";
import {
  formatDatabaseSanitizedSummary,
  loadDatabaseEnvConfig,
  validateDatabaseEnvConfig,
  type DatabaseConfigValidation,
  type DatabaseConnectionConfig,
} from "@/lib/db-env-config";

export function getDatabaseConfig(): DatabaseConnectionConfig | null {
  try {
    return loadDatabaseEnvConfig(process.env);
  } catch {
    return null;
  }
}

export function getDatabaseSanitizedSummary(): string {
  const config = getDatabaseConfig();
  return config
    ? formatDatabaseSanitizedSummary(config)
    : "DATABASE_URL tidak diatur";
}

export function validateDatabaseConfig(): DatabaseConfigValidation {
  try {
    return validateDatabaseEnvConfig(loadDatabaseEnvConfig(process.env));
  } catch (error) {
    return {
      valid: false,
      errors: [
        error instanceof Error ? error.message : "DATABASE_URL tidak valid.",
      ],
    };
  }
}
