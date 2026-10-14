import { getRawPool } from "@/db";
import { redactSecrets } from "@/services/device-connection-tester";
import { DeviceConnectionError } from "@/lib/device-connection";
import { MikrotikRestClient } from "@/lib/mikrotik/client";
import { mapMikrotikError } from "@/lib/mikrotik/errors";
import {
  splitHostInput,
  validateOnboardingMikrotikInput,
  type OnboardingMikrotikInput,
  type OnboardingMikrotikTestResult,
} from "@/lib/dashboard/onboarding-mikrotik";

export interface OnboardingMikrotikConfigStatus {
  configured: boolean;
  isGateUnlocked: boolean;
  envConfigured: boolean;
  databaseConfigured: boolean;
  routerCount: number;
  activeRouterCount: number;
  primaryRouter: {
    name: string;
    host: string;
    port: number;
    username: string;
    status: string;
    lastSeenAt: string | null;
  } | null;
  checkedAt: string;
}

/**
 * Membaca status konfigurasi router MikroTik saat ini (kombinasi variabel lingkungan dan database).
 */
export async function getOnboardingMikrotikStatus(): Promise<OnboardingMikrotikConfigStatus> {
  const envHost = process.env.MIKROTIK_REST_HOST?.trim();
  const envUser = process.env.MIKROTIK_REST_USER?.trim();
  const envPort = Number(process.env.MIKROTIK_REST_PORT ?? 443);
  const envConfigured = Boolean(envHost && envUser);

  let routerCount = 0;
  let activeRouterCount = 0;
  let primaryRouter: OnboardingMikrotikConfigStatus["primaryRouter"] = null;

  try {
    const pool = getRawPool();
    const client = await pool.connect();
    try {
      const res = await client.query(`
        SELECT "id", "name", "host", "username", "status", "last_seen_at"
        FROM "routers"
        ORDER BY "created_at" ASC
      `);

      routerCount = res.rows.length;
      activeRouterCount = res.rows.filter(
        (r) => r.status === "aktif" && Boolean(r.last_seen_at),
      ).length;

      if (res.rows.length > 0) {
        const top = res.rows[0];
        primaryRouter = {
          name: top.name,
          host: top.host,
          port: 443,
          username: top.username,
          status: top.status,
          lastSeenAt: top.last_seen_at ? new Date(top.last_seen_at).toISOString() : null,
        };
      }
    } finally {
      client.release();
    }
  } catch {
    // Database mungkin belum aktif
  }

  // Jika di database belum ada tapi env terisi, jadikan env sebagai data router
  if (!primaryRouter && envConfigured) {
    primaryRouter = {
      name: "Router Core MikroTik (Env)",
      host: envHost!,
      port: envPort,
      username: envUser!,
      status: "aktif",
      lastSeenAt: null,
    };
  }

  // Router hanya dianggap configured jika ada router aktif yang terverifikasi (pernah terhubung / last_seen_at valid)
  const hasVerifiedRouter = Boolean(primaryRouter?.lastSeenAt) || activeRouterCount > 0;
  const configured = hasVerifiedRouter;
  const isGateUnlocked = configured;

  return {
    configured,
    isGateUnlocked,
    envConfigured,
    databaseConfigured: routerCount > 0,
    routerCount,
    activeRouterCount,
    primaryRouter,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Menjalankan uji koneksi MikroTik langsung dan mengembalikan hasil komprehensif.
 */
export async function executeOnboardingMikrotikTest(
  input: OnboardingMikrotikInput,
): Promise<OnboardingMikrotikTestResult> {
  const val = validateOnboardingMikrotikInput(input);
  if (!val.valid) {
    return {
      ok: false,
      latencyMs: 0,
      testedAt: new Date().toISOString(),
      message: "Validasi konfigurasi gagal.",
      errors: Object.values(val.errors),
    };
  }

  // Satu-satunya jalur uji: REST RouterOS, sama dengan yang dipakai poller setelah router disimpan.
  // Angka hanya dari router; tidak ada nilai bawaan karangan bila resource kosong.
  const parsed = splitHostInput(input.host);
  const secrets = { username: input.username, password: input.password };
  const fail = (code: string, message: string, latencyMs = 0): OnboardingMikrotikTestResult => ({
    ok: false,
    latencyMs,
    testedAt: new Date().toISOString(),
    code,
    message: redactSecrets(message, secrets),
    errors: [mapMikrotikError(new DeviceConnectionError(code, message)).hint],
  });

  let client: MikrotikRestClient;
  try {
    client = new MikrotikRestClient({
      host: parsed.host,
      port: parsed.port ?? input.port,
      useSsl: parsed.useTls ?? input.useTls,
      username: input.username.trim(),
      password: input.password ?? "",
      mode: input.mode,
    });
  } catch (err) {
    if (err instanceof DeviceConnectionError) return fail(err.code, err.message);
    throw err;
  }

  const result = await client.testConnection();
  if (!result.ok || !result.resource) {
    return fail(result.code ?? "CONNECTION_FAILED", result.message, result.latencyMs);
  }
  const r = result.resource;
  const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));
  return {
    ok: true,
    latencyMs: result.latencyMs,
    testedAt: new Date().toISOString(),
    message: result.message,
    details: {
      version: r.version,
      boardName: r.boardName,
      cpuLoad: r.cpuLoad,
      freeMemoryMb: mb(r.freeMemory),
      totalMemoryMb: mb(r.totalMemory),
      uptime: r.uptime,
    },
  };
}
