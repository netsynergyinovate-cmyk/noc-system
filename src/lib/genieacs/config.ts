// Konfigurasi koneksi GenieACS NBI. Murni (tanpa server-only / alias path) agar
// bisa diuji langsung dengan node --test.

export const GENIEACS_SIMULATOR_URL = "http://genieacs-simulator.local:7557";
export const GENIEACS_DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 60000;

export interface GenieAcsConfig {
  url: string;
  username?: string;
  password?: string;
  timeoutMs: number;
  mode: "real" | "simulator";
  /** `Basic <base64>`; hanya ada bila username dan password terisi. */
  authHeader?: string;
}

type EnvLike = Record<string, string | undefined>;

/** Validasi URL http(s) dan buang kredensial yang tertanam (user:pass@host). */
export function sanitizeGenieacsUrl(urlStr: string): string {
  const url = new URL(urlStr.trim());
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("GENIEACS_NBI_URL harus http:// atau https://");
  }
  url.username = "";
  url.password = "";
  return url.toString().replace(/\/$/, "");
}

function parseTimeout(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return GENIEACS_DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < MIN_TIMEOUT_MS || n > MAX_TIMEOUT_MS) {
    return GENIEACS_DEFAULT_TIMEOUT_MS;
  }
  return n;
}

export function getGenieacsConfig(env: EnvLike = process.env): GenieAcsConfig {
  const rawUrl = env.GENIEACS_NBI_URL?.trim();
  const timeoutMs = parseTimeout(env.GENIEACS_TIMEOUT_MS);

  // Hanya "live" + URL yang menyentuh GenieACS sungguhan; selain itu simulator.
  if (env.DASHBOARD_DATA !== "live" || !rawUrl) {
    return { url: GENIEACS_SIMULATOR_URL, timeoutMs, mode: "simulator" };
  }

  const username = env.GENIEACS_NBI_USER?.trim() || undefined;
  const password = env.GENIEACS_NBI_PASSWORD || undefined;
  const config: GenieAcsConfig = {
    url: sanitizeGenieacsUrl(rawUrl),
    timeoutMs,
    mode: "real",
  };
  if (username && password) {
    config.username = username;
    config.password = password;
    config.authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }
  return config;
}
