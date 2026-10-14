import "server-only";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { billingCredentials, olts, routers } from "@/db/schema";
import { env } from "@/lib/env";
import {
  readBillingEnv,
  readGenieacsEnv,
  readMikrotikEnv,
  readOltEnv,
} from "@/lib/device-env-credentials";
import { decryptDeviceCredential, encryptDeviceCredential } from "@/lib/encryption";

// Satu-satunya pintu membaca kredensial perangkat. Hasil berisi kata sandi
// ASLI: hanya untuk konektor di server (MikroTik/OLT/billing/GenieACS), jangan
// pernah dikembalikan dari API route atau dikirim ke klien. Untuk tampilan
// klien pakai query dengan kolom publik (tanpa passwordEnc).

export const encryptCredential = (plain: string): string => encryptDeviceCredential(plain);
export const decryptCredential = (encrypted: string): string => decryptDeviceCredential(encrypted);

// ponytail: port/TLS router & OLT diturunkan dari "host[:port]" karena tabel
// belum punya kolom port/use_tls; tambah kolom bila ada TLS di port nonstandar.
function splitHostPort(raw: string): { host: string; port: number; useTls: boolean } {
  const m = /^(?:https?:\/\/)?(\[[^\]]+\]|[^:/]+)(?::(\d{1,5}))?\/?$/i.exec(raw.trim());
  const host = m?.[1] ?? raw.trim();
  const port = m?.[2] ? Number(m[2]) : /^https:/i.test(raw) ? 443 : 80;
  return { host, port, useTls: /^https:/i.test(raw) || port === 443 || port === 8443 };
}

export async function getRouterDecryptedCredentials(routerId: string) {
  const [r] = await db.select().from(routers).where(eq(routers.id, routerId)).limit(1);
  if (!r) return null;
  const { host, port, useTls } = splitHostPort(r.host);
  return {
    id: r.id, name: r.name, host, port, username: r.username,
    password: decryptCredential(r.passwordEnc), useTls,
  };
}

export async function getOltDecryptedCredentials(oltId: string) {
  const [o] = await db.select().from(olts).where(eq(olts.id, oltId)).limit(1);
  if (!o) return null;
  const { host, port } = splitHostPort(o.host);
  return {
    id: o.id, name: o.name, host, port, username: o.username,
    password: decryptCredential(o.passwordEnc),
  };
}

export async function getBillingDecryptedCredentials() {
  const [b] = await db
    .select()
    .from(billingCredentials)
    .where(and(eq(billingCredentials.isActive, true)))
    .orderBy(desc(billingCredentials.updatedAt))
    .limit(1);
  if (!b) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(b.url) ? b.url : `http://${b.url}`);
  } catch {
    return null;
  }
  const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
  return {
    host: u.hostname, port, username: b.username,
    password: decryptCredential(b.passwordEnc),
  };
}

// Kredensial dari env (kata sandi ASLI; server saja).
export const getMikrotikEnvCredentials = () => readMikrotikEnv(process.env);
export const getOltEnvCredentials = () => readOltEnv(process.env);
export const getGenieacsEnvCredentials = () => readGenieacsEnv(process.env);
export const getBillingEnvCredentials = () => readBillingEnv(process.env);

// Resolver: database dulu, env sebagai fallback.
export async function resolveRouterCredentials(routerId?: string) {
  const db_ = routerId ? await getRouterDecryptedCredentials(routerId) : null;
  if (db_) return { ...db_, source: "database" as const };
  return { ...getMikrotikEnvCredentials(), source: "env" as const };
}

export async function resolveOltCredentials(oltId?: string) {
  const db_ = oltId ? await getOltDecryptedCredentials(oltId) : null;
  if (db_) return { ...db_, source: "database" as const };
  return { ...getOltEnvCredentials(), source: "env" as const };
}

export async function resolveBillingCredentials() {
  const db_ = await getBillingDecryptedCredentials();
  if (db_) return { ...db_, source: "database" as const };
  return { ...getBillingEnvCredentials(), source: "env" as const };
}

// GenieACS NBI memakai env (tanpa tabel); tidak ada enkripsi di sini.
export async function getGenieacsDecryptedCredentials() {
  if (!env.GENIEACS_NBI_URL) return null;
  return {
    url: env.GENIEACS_NBI_URL,
    username: env.GENIEACS_NBI_USER ?? "",
    password: env.GENIEACS_NBI_PASSWORD ?? "",
  };
}
