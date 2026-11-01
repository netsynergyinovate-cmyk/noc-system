import crypto from "crypto";
import { utils } from "ssh2";
import { db } from "@/db";
import { sshCredentials, type SshCredential } from "@/db/schema/ssh-credentials";
import { encryptWithKey, decryptWithKey } from "@/lib/encryption-core";
import { eq } from "drizzle-orm";

export interface SshCredentialMeta {
  id: string;
  targetId: string;
  fingerprint: string;
  hasPassphrase: boolean;
  authType: "key" | "password";
  createdAt: string;
  rotatedAt: string | null;
}

export interface DecryptedSshCredential {
  privateKey?: string;
  passphrase?: string;
  password?: string;
  fingerprint: string;
}

function getMasterSecret(): string {
  const secret =
    process.env.SSH_KEY_SECRET ||
    process.env.DEVICE_SECRET ||
    process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "Kunci enkripsi master belum disetel (DEVICE_SECRET atau SSH_KEY_SECRET wajib ada di .env.local).",
    );
  }
  return secret;
}

/**
 * Menghitung fingerprint SHA256 dari kunci privat/publik untuk penandaan.
 */
export function computeFingerprint(keyText: string, passphrase?: string | null): string {
  const clean = keyText.trim();
  const parsed = utils.parseKey(clean, passphrase || undefined);
  if (parsed instanceof Error) {
    throw new Error(`Kunci privat SSH tidak valid atau passphrase salah: ${parsed.message}`);
  }
  const publicBytes = parsed.getPublicSSH();
  const hash = crypto.createHash("sha256").update(publicBytes).digest("base64").replace(/=+$/, "");
  return `SHA256:${hash}`;
}

/**
 * Menyimpan kunci privat SSH terenkripsi AES-256-GCM.
 * Kunci asli tidak pernah disimpan dalam bentuk plaintext.
 */
export async function saveSshCredential(
  targetId: string,
  privateKeyOrOptions:
    | string
    | {
        authType?: "key" | "password";
        privateKey?: string | null;
        passphrase?: string | null;
        password?: string | null;
      },
  maybePassphrase?: string | null,
): Promise<SshCredentialMeta> {
  const opts =
    typeof privateKeyOrOptions === "string"
      ? {
          authType: "key" as const,
          privateKey: privateKeyOrOptions,
          passphrase: maybePassphrase,
          password: null,
        }
      : {
          authType: privateKeyOrOptions.authType || (privateKeyOrOptions.password ? "password" : "key"),
          privateKey: privateKeyOrOptions.privateKey || null,
          passphrase: privateKeyOrOptions.passphrase || null,
          password: privateKeyOrOptions.password || null,
        };

  const masterSecret = getMasterSecret();
  let privateKeyEnc: string | null = null;
  let passphraseEnc: string | null = null;
  let passwordEnc: string | null = null;
  let fingerprint = "PASSWORD";
  const authType = opts.authType as "key" | "password";

  if (authType === "password" || opts.password) {
    const cleanPass = (opts.password || "").trim();
    if (!cleanPass) {
      throw new Error("Password SSH tidak boleh kosong.");
    }
    passwordEnc = encryptWithKey(cleanPass, masterSecret);
    fingerprint = "PASSWORD";
  } else {
    const cleanKey = (opts.privateKey || "").trim();
    if (!cleanKey.includes("PRIVATE KEY")) {
      throw new Error("Format kunci privat tidak valid (wajib format OpenSSH atau PEM/RSA).");
    }
    fingerprint = computeFingerprint(cleanKey, opts.passphrase);
    privateKeyEnc = encryptWithKey(cleanKey, masterSecret);
    passphraseEnc = opts.passphrase?.trim()
      ? encryptWithKey(opts.passphrase.trim(), masterSecret)
      : null;
  }

  const existing = await db
    .select()
    .from(sshCredentials)
    .where(eq(sshCredentials.targetId, targetId))
    .limit(1);

  let row: SshCredential;
  if (existing.length > 0) {
    const [updated] = await db
      .update(sshCredentials)
      .set({
        privateKeyEnc,
        passphraseEnc,
        passwordEnc,
        fingerprint,
        rotatedAt: new Date(),
      })
      .where(eq(sshCredentials.id, existing[0].id))
      .returning();
    row = updated;
  } else {
    const [inserted] = await db
      .insert(sshCredentials)
      .values({
        targetId,
        privateKeyEnc,
        passphraseEnc,
        passwordEnc,
        fingerprint,
      })
      .returning();
    row = inserted;
  }

  return {
    id: row.id,
    targetId: row.targetId,
    fingerprint: row.fingerprint,
    hasPassphrase: Boolean(row.passphraseEnc),
    authType: Boolean(row.passwordEnc) ? "password" : "key",
    createdAt: row.createdAt.toISOString(),
    rotatedAt: row.rotatedAt ? row.rotatedAt.toISOString() : null,
  };
}

/**
 * Mengambil metadata kunci privat tanpa membuka plaintext.
 * Aman dikembalikan ke API/UI.
 */
export async function getSshCredentialMeta(
  targetId: string,
): Promise<SshCredentialMeta | null> {
  const rows = await db
    .select()
    .from(sshCredentials)
    .where(eq(sshCredentials.targetId, targetId))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];

  return {
    id: row.id,
    targetId: row.targetId,
    fingerprint: row.fingerprint,
    hasPassphrase: Boolean(row.passphraseEnc),
    authType: Boolean(row.passwordEnc) ? "password" : "key",
    createdAt: row.createdAt.toISOString(),
    rotatedAt: row.rotatedAt ? row.rotatedAt.toISOString() : null,
  };
}

/**
 * Mengambil dan mendekripsi kunci privat untuk kebutuhan koneksi SSH server-side.
 * JANGAN PERNAH diekspos melalui API response!
 */
export async function getDecryptedSshCredential(
  targetId: string,
): Promise<DecryptedSshCredential | null> {
  const rows = await db
    .select()
    .from(sshCredentials)
    .where(eq(sshCredentials.targetId, targetId))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];
  const masterSecret = getMasterSecret();

  const privateKey = row.privateKeyEnc
    ? decryptWithKey(row.privateKeyEnc, masterSecret)
    : undefined;
  const passphrase = row.passphraseEnc
    ? decryptWithKey(row.passphraseEnc, masterSecret)
    : undefined;
  const password = row.passwordEnc
    ? decryptWithKey(row.passwordEnc, masterSecret)
    : undefined;

  return {
    privateKey,
    passphrase,
    password,
    fingerprint: row.fingerprint,
  };
}

/**
 * Menghapus kredensial SSH untuk target tertentu.
 */
export async function deleteSshCredential(targetId: string): Promise<boolean> {
  const result = await db
    .delete(sshCredentials)
    .where(eq(sshCredentials.targetId, targetId))
    .returning();
  return result.length > 0;
}
