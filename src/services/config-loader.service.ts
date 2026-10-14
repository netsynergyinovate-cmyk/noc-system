import "server-only";
import {
  loadCentralConfig,
  redactCentralConfig,
  validateCentralConfig,
  type CentralConfig,
  type RedactedCentralConfig,
} from "@/lib/central-config-loader";

export function getAppConfig(): CentralConfig {
  return loadCentralConfig(process.env);
}

export function getRedactedAppConfig(): RedactedCentralConfig {
  return redactCentralConfig(getAppConfig());
}

export function getAppConfigValidation(): ReturnType<
  typeof validateCentralConfig
> {
  return validateCentralConfig(getAppConfig());
}
