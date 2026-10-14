import { env } from "./env";
import { decryptWithKey, encryptWithKey } from "./encryption-core";

export { decryptWithKey, encryptWithKey };

function secret(): string {
  if (!env.DEVICE_SECRET) throw new Error("DEVICE_SECRET is not configured");
  return env.DEVICE_SECRET;
}

/** Enkripsi dengan DEVICE_SECRET. Format base64 "iv:tag:ciphertext". */
export function encryptAES256GCM(text: string): string {
  return encryptWithKey(text, secret());
}

/** Dekripsi hasil encryptAES256GCM. */
export function decryptAES256GCM(encryptedData: string): string {
  return decryptWithKey(encryptedData, secret());
}

const SECRET_MISSING =
  "Kunci enkripsi perangkat belum dikonfigurasi (set DEVICE_SECRET atau ROUTER_SECRET_KEY).";

function deviceSecret(): string {
  const key = env.DEVICE_SECRET || process.env.ROUTER_SECRET_KEY;
  if (!key || !key.trim()) throw new Error(SECRET_MISSING);
  return key;
}

/** Enkripsi kredensial perangkat (DEVICE_SECRET, fallback ROUTER_SECRET_KEY). Format "iv:tag:ciphertext". */
export function encryptDeviceCredential(plaintext: string): string {
  return encryptWithKey(plaintext, deviceSecret());
}

/** Dekripsi hasil encryptDeviceCredential. Error tidak memuat plaintext maupun kunci. */
export function decryptDeviceCredential(ciphertext: string): string {
  return decryptWithKey(ciphertext, deviceSecret());
}
