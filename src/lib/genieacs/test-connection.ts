// Logika murni uji koneksi GenieACS NBI (tanpa server-only / alias path)
// agar bisa diuji langsung dengan node --test. Dipakai route /api/cpe/test
// dan device-connection.service.

import { GenieAcsClient } from "./client.ts";
import {
  getGenieacsConfig,
  GENIEACS_SIMULATOR_URL,
  sanitizeGenieacsUrl,
} from "./config.ts";
import type { GenieAcsConfig } from "./config.ts";

export interface GenieAcsTestInput {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  mode?: "simulator" | "real";
}

export type GenieAcsTestResult = {
  ok: boolean;
  latencyMs: number;
  error?: string;
  deviceCount?: number;
  mode: "simulator" | "real";
};

/** Config dari input; tanpa host/mode/kredensial, pakai config env. Melempar Error bila host tidak valid. */
export function buildGenieacsTestConfig(
  input: GenieAcsTestInput,
  env: Record<string, string | undefined> = process.env,
): GenieAcsConfig {
  const host = input.host?.trim();
  const username = input.username?.trim() || undefined;
  const base = getGenieacsConfig(env);

  if (
    !host &&
    !username &&
    !input.password &&
    !input.mode &&
    input.port === undefined
  ) {
    return base;
  }
  if (input.mode === "simulator") {
    return {
      url: GENIEACS_SIMULATOR_URL,
      timeoutMs: base.timeoutMs,
      mode: "simulator",
    };
  }
  if (!host) {
    if (input.mode === "real")
      throw new Error("Host wajib diisi untuk mode real.");
    return base;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host) && !/^https?:\/\//i.test(host)) {
    throw new Error("Protokol harus http atau https.");
  }
  const parsed = new URL(/^https?:\/\//i.test(host) ? host : `http://${host}`);
  if (input.port !== undefined && !parsed.port)
    parsed.port = String(input.port);
  const config: GenieAcsConfig = {
    url: sanitizeGenieacsUrl(parsed.toString()),
    timeoutMs: base.timeoutMs,
    mode: "real",
  };
  if (username && input.password) {
    config.username = username;
    config.password = input.password;
    config.authHeader = `Basic ${Buffer.from(`${username}:${input.password}`).toString("base64")}`;
  }
  return config;
}

/** Buang kata sandi dan header Basic dari teks error sebelum dikirim ke klien. */
export function scrubSecrets(text: string, config: GenieAcsConfig): string {
  let out = text;
  const secrets = [
    config.password,
    config.authHeader,
    config.authHeader?.replace(/^Basic /, ""),
  ];
  for (const s of secrets) if (s) out = out.split(s).join("***");
  return out.replace(/\/\/[^/@\s]*:[^/@\s]*@/g, "//***@");
}

/** Hasil uji GenieACS dalam bentuk seragam DeviceTestResult (7 field wajib) + field lama. */
export function toStandardTestResult(
  config: GenieAcsConfig,
  r: GenieAcsTestResult,
) {
  const timedOut = !r.ok && /timeout|timed? ?out|abort/i.test(r.error ?? "");
  const authFailed = !r.ok && /\b40[13]\b/.test(r.error ?? "");
  return {
    ...r,
    ok: r.ok,
    status: r.ok ? "connected" : timedOut ? "timeout" : "error",
    code: r.ok
      ? "OK"
      : timedOut
        ? "TIMEOUT"
        : authFailed
          ? "AUTH_FAILED"
          : "HTTP_ERROR",
    message: r.ok
      ? `Sukses: NBI GenieACS /devices menjawab (${r.deviceCount ?? 0} perangkat).`
      : (r.error ?? "Gagal terhubung ke GenieACS"),
    latencyMs: r.latencyMs,
    endpointTested: `GET ${config.url.replace(/\/+$/, "")}/devices/`,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

export async function runGenieacsTest(
  config: GenieAcsConfig,
  fetchImpl?: typeof fetch,
): Promise<GenieAcsTestResult> {
  const result = await new GenieAcsClient(config, fetchImpl).testConnection();
  if (result.error) result.error = scrubSecrets(result.error, config);
  return { ...result, mode: config.mode };
}
