import { getRawPool } from "@/db";
import {
  evaluateOptionalIntegrations,
  OPTIONAL_INTEGRATION_TEMPLATES,
  type OptionalIntegrationItem,
  type OptionalIntegrationsOverview,
  type OptionalIntegrationStatus,
} from "@/lib/dashboard/optional-integrations";

let customStatusOverrides: Record<string, OptionalIntegrationStatus> = {};

/**
 * Membaca status integrasi opsional secara cerdas (gabungan environment dan data tabel PostgreSQL).
 */
export async function getRealOptionalIntegrationsOverview(): Promise<OptionalIntegrationsOverview> {
  const dynamicStatus: Record<string, OptionalIntegrationStatus> = {
    ...customStatusOverrides,
  };

  try {
    const pool = getRawPool();
    const client = await pool.connect();
    try {
      // 1. Periksa tabel olts
      if (!dynamicStatus["opt-olt-hsgq"]) {
        const oltRes = await client.query('SELECT COUNT(*) AS c FROM "olts"');
        if (Number(oltRes.rows[0]?.c ?? 0) > 0) {
          dynamicStatus["opt-olt-hsgq"] = "terkonfigurasi";
        }
      }

      // 2. Periksa tabel whatsapp_recipients
      if (!dynamicStatus["opt-whatsapp-gateway"]) {
        const waRes = await client.query(
          'SELECT COUNT(*) AS c FROM "whatsapp_recipients"',
        );
        if (Number(waRes.rows[0]?.c ?? 0) > 0) {
          dynamicStatus["opt-whatsapp-gateway"] = "terkonfigurasi";
        }
      }

      // 3. Periksa tabel billing_credentials
      if (!dynamicStatus["opt-billing-sync"]) {
        const billRes = await client.query(
          'SELECT COUNT(*) AS c FROM "billing_credentials"',
        );
        if (Number(billRes.rows[0]?.c ?? 0) > 0) {
          dynamicStatus["opt-billing-sync"] = "terkonfigurasi";
        }
      }
    } finally {
      client.release();
    }
  } catch {
    // Database tidak aktif saat pengujian terisolasi
  }

  return evaluateOptionalIntegrations(process.env, dynamicStatus);
}

/**
 * Memperbarui status integrasi modul opsional tertentu (mis. untuk pengujian / testing).
 */
export function setOptionalIntegrationStatusOverride(
  id: string,
  status: OptionalIntegrationStatus,
): void {
  customStatusOverrides[id] = status;
}

/**
 * Reset status overrides (isolasi unit test).
 */
export function resetOptionalIntegrationOverrides(): void {
  customStatusOverrides = {};
}
