import { decryptWithKey, encryptWithKey } from "@/lib/encryption-core";

// Fungsi murni untuk kredensial/sesi scraper billing. Tanpa akses DB dan tanpa
// "server-only" supaya bisa diuji langsung; query DB ditambah saat scraper terhubung.

export const BACKOFF_FAILURE_THRESHOLD = 3;
export const BACKOFF_MS = 6 * 60 * 60 * 1000;

function secret(key?: string): string {
  const k = key ?? process.env.DEVICE_SECRET;
  if (!k) throw new Error("DEVICE_SECRET is not configured");
  return k;
}

/** AES-256-GCM, format base64 "iv:tag:ciphertext". Kunci bawaan: DEVICE_SECRET. */
export function encryptSecret(plain: string, key?: string): string {
  return encryptWithKey(plain, secret(key));
}

/** Melempar error bila format, tag GCM, atau ciphertext rusak/dimanipulasi. */
export function decryptSecret(encrypted: string, key?: string): string {
  return decryptWithKey(encrypted, secret(key));
}

/** Cookie jadi JSON objek { nama: nilai }; nama yang sama: nilai terakhir menang. */
export function serializeCookies(
  cookies: Record<string, string> | Array<{ name: string; value: string }>,
): string {
  const map: Record<string, string> = Object.create(null);
  if (Array.isArray(cookies)) {
    for (const c of cookies) map[c.name] = c.value;
  } else {
    Object.assign(map, cookies);
  }
  return JSON.stringify(map);
}

/** Kebalikan serializeCookies. Melempar error bila bukan objek { string: string }. */
export function deserializeCookies(jsonStr: string): Record<string, string> {
  const parsed: unknown = JSON.parse(jsonStr);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid cookies format");
  }
  const out: Record<string, string> = Object.create(null);
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== "string") throw new Error("Invalid cookies format");
    out[k] = v;
  }
  return { ...out }; // spread = own data property, aman untuk kunci "__proto__"
}

/** True selama `now` < backoffUntil. */
export function isBackoffActive(
  backoffUntil: Date | null,
  now: Date = new Date(),
): boolean {
  return backoffUntil !== null && backoffUntil.getTime() > now.getTime();
}

/** Gagal berturut-turut >= 3: tahan 6 jam. Kurang dari itu: null (tanpa backoff). */
export function calculateNextBackoff(
  failures: number,
  now: Date = new Date(),
): Date | null {
  return failures >= BACKOFF_FAILURE_THRESHOLD
    ? new Date(now.getTime() + BACKOFF_MS)
    : null;
}
