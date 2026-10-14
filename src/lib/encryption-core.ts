import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/**
 * Kunci tepat 32 byte dipakai apa adanya (kompatibel dengan data lama);
 * panjang lain diturunkan lewat SHA-256 agar tidak melempar error AES.
 */
export function normalizeKey(secret: string | Buffer): Buffer {
  const raw = typeof secret === "string" ? Buffer.from(secret, "utf-8") : secret;
  if (raw.length === 0) throw new Error("Encryption key is empty");
  return raw.length === 32 ? raw : crypto.createHash("sha256").update(raw).digest();
}

/** Enkripsi AES-256-GCM. Format base64 "iv:tag:ciphertext". */
export function encryptWithKey(text: string, key: string | Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, normalizeKey(key), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((b) => b.toString("base64")).join(":");
}

/** Dekripsi hasil encryptWithKey. Melempar error jika format/tag/ciphertext rusak. */
export function decryptWithKey(data: string, key: string | Buffer): string {
  const parts = data.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted format");
  const [iv, tag, enc] = parts.map((p) => Buffer.from(p, "base64"));
  if (iv.length !== IV_LENGTH || tag.length !== 16) {
    throw new Error("Invalid encrypted format");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, normalizeKey(key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
