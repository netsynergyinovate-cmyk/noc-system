import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, user } from "@/db/schema";
import type { CreateApiKeyInput } from "@/validators/api-keys";

export const API_KEY_PREFIX = "noc_";

// Kunci acak 256 bit, jadi SHA-256 biasa cukup (tidak perlu hash lambat).
export function hashApiKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

const publicColumns = {
  id: apiKeys.id,
  name: apiKeys.name,
  prefix: apiKeys.prefix,
  access: apiKeys.access,
  lastUsedAt: apiKeys.lastUsedAt,
  revokedAt: apiKeys.revokedAt,
  createdAt: apiKeys.createdAt,
};

// Mengembalikan kunci utuh SEKALI; yang disimpan hanya hash-nya.
export async function createApiKey(userId: string, input: CreateApiKeyInput) {
  const key = API_KEY_PREFIX + randomBytes(32).toString("base64url");
  const [apiKey] = await db
    .insert(apiKeys)
    .values({
      name: input.name,
      access: input.access,
      userId,
      prefix: key.slice(0, 12),
      keyHash: hashApiKey(key),
    })
    .returning(publicColumns);
  return { key, apiKey };
}

export function listApiKeysAny() {
  return db
    .select({ ...publicColumns, ownerEmail: user.email })
    .from(apiKeys)
    .innerJoin(user, eq(user.id, apiKeys.userId))
    .orderBy(desc(apiKeys.createdAt));
}

export async function revokeApiKeyAny(id: string) {
  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  return rows.length > 0;
}

// Pemilik kunci yang masih berlaku. null bila kunci salah, sudah dicabut, atau
// akun pemiliknya sedang diblokir.
export async function findApiKeyOwner(key: string) {
  if (!key.startsWith(API_KEY_PREFIX)) return null;
  const [row] = await db
    .select({
      id: apiKeys.id,
      access: apiKeys.access,
      lastUsedAt: apiKeys.lastUsedAt,
      owner: user,
    })
    .from(apiKeys)
    .innerJoin(user, eq(user.id, apiKeys.userId))
    .where(and(eq(apiKeys.keyHash, hashApiKey(key)), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;
  const { banned, banExpires } = row.owner;
  if (banned && (!banExpires || banExpires > new Date())) return null;

  // Paling sering semenit sekali, supaya penarikan beruntun tidak menulis tiap permintaan.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000)
    await db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id));
  return row;
}
