import "server-only";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { impliesTls, sanitizeHost, storedRouterHost } from "@/lib/device-connection";
import { MikrotikRestClient } from "@/lib/mikrotik/client";
import { alerts, customers, networkLogs, routers } from "@/db/schema";
import { CreateRouterInput, UpdateRouterInput } from "@/validators/routers";
import { encryptAES256GCM, decryptAES256GCM } from "@/lib/encryption";

// Kolom router yang boleh sampai ke klien. `passwordEnc` (kata sandi router
// yang dienkripsi) sengaja tidak ada: ia tidak boleh keluar dari server,
// terenkripsi sekalipun. Dipilih di SQL (`returning`), bukan dibuang di route,
// supaya tidak ada pemanggil yang bisa lupa menyaringnya.
const publicRouterColumns = {
  id: routers.id,
  name: routers.name,
  host: routers.host,
  username: routers.username,
  status: routers.status,
  lastSeenAt: routers.lastSeenAt,
  createdAt: routers.createdAt,
};

export async function getRouterById(id: string) {
  const [router] = await db
    .select(publicRouterColumns)
    .from(routers)
    .where(eq(routers.id, id))
    .limit(1);
  if (!router) {
    throw new ApiError(404, "ROUTER_NOT_FOUND", "Router tidak ditemukan.");
  }
  return router;
}

export async function createRouter(input: CreateRouterInput) {
  let normalizedHost: string;
  try {
    const url = sanitizeHost(input.host, input.port);
    normalizedHost = storedRouterHost(url, input.useSsl ?? impliesTls(url));
  } catch (e) {
    throw new ApiError(422, "INVALID_HOST", (e as Error).message);
  }

  const [dup] = await db
    .select({ id: routers.id })
    .from(routers)
    .where(eq(routers.host, normalizedHost))
    .limit(1);
  if (dup)
    throw new ApiError(409, "DUPLICATE_HOST", "Router dengan host ini sudah terdaftar.");

  // Pre-flight: pastikan router bisa dihubungi sebelum disimpan.
  if (input.validateConnection !== false) {
    const result = await new MikrotikRestClient({
      host: normalizedHost,
      username: input.username,
      password: input.password,
      mode: input.mode ?? (env.DASHBOARD_DATA === "demo" ? "simulator" : "real"),
    }).testConnection();
    if (!result.ok)
      throw new ApiError(400, result.code ?? "CONNECTION_FAILED", result.message);
  }

  const encryptedPassword = encryptAES256GCM(input.password);

  const [router] = await db
    .insert(routers)
    .values({
      name: input.name,
      host: normalizedHost,
      username: input.username,
      passwordEnc: encryptedPassword,
      status: "aktif",
      lastSeenAt: input.validateConnection !== false ? new Date() : null,
    })
    .returning(publicRouterColumns);

  return router;
}

export async function updateRouter(id: string, input: UpdateRouterInput) {
  const [existing] = await db
    .select({
      id: routers.id,
      name: routers.name,
      host: routers.host,
      username: routers.username,
      passwordEnc: routers.passwordEnc,
      status: routers.status,
    })
    .from(routers)
    .where(eq(routers.id, id))
    .limit(1);

  if (!existing) {
    throw new ApiError(404, "ROUTER_NOT_FOUND", "Router tidak ditemukan.");
  }

  const updates: Partial<{
    name: string;
    host: string;
    username: string;
    passwordEnc: string;
    status: "aktif" | "nonaktif";
    lastSeenAt: Date | null;
  }> = {};

  if (input.name) updates.name = input.name;
  if (input.status) updates.status = input.status;
  if (input.username) updates.username = input.username;

  let targetHost = existing.host;
  if (input.host) {
    try {
      const url = sanitizeHost(input.host, input.port);
      targetHost = storedRouterHost(url, input.useSsl ?? impliesTls(url));
      updates.host = targetHost;
    } catch (e) {
      throw new ApiError(422, "INVALID_HOST", (e as Error).message);
    }

    if (targetHost !== existing.host) {
      const [dup] = await db
        .select({ id: routers.id })
        .from(routers)
        .where(eq(routers.host, targetHost))
        .limit(1);
      if (dup && dup.id !== id) {
        throw new ApiError(409, "DUPLICATE_HOST", "Router dengan host ini sudah terdaftar.");
      }
    }
  }

  let targetPassword = decryptAES256GCM(existing.passwordEnc);
  if (input.password) {
    targetPassword = input.password;
    updates.passwordEnc = encryptAES256GCM(input.password);
  }

  const targetUsername = input.username ?? existing.username;

  if (input.validateConnection) {
    const result = await new MikrotikRestClient({
      host: targetHost,
      username: targetUsername,
      password: targetPassword,
      mode: input.mode ?? (env.DASHBOARD_DATA === "demo" ? "simulator" : "real"),
    }).testConnection();
    if (!result.ok) {
      throw new ApiError(400, result.code ?? "CONNECTION_FAILED", result.message);
    }
    updates.lastSeenAt = new Date();
  }

  const [updated] = await db
    .update(routers)
    .set(updates)
    .where(eq(routers.id, id))
    .returning(publicRouterColumns);

  return updated;
}

// Pelanggan, alert, dan log jaringan memakai FK `restrict`: router yang masih dipakai TIDAK terhapus diam-diam.
// Tanpa `force` jawabannya 409 berisi jumlah datanya; dengan `force` semuanya dihapus dalam satu transaksi
// (gagal di tengah = tidak ada yang terhapus). Data deret waktu, syslog, dan exporter ikut terhapus lewat cascade.
export async function deleteRouter(id: string, { force = false }: { force?: boolean } = {}) {
  return db.transaction(async (tx) => {
    const used = async (table: typeof customers | typeof alerts | typeof networkLogs) => {
      const [row] = await tx.select({ n: count() }).from(table).where(eq(table.routerId, id));
      return row.n;
    };
    const usage = { pelanggan: await used(customers), alert: await used(alerts), logJaringan: await used(networkLogs) };
    const inUse = Object.values(usage).some((n) => n > 0);
    if (inUse && !force) {
      throw new ApiError(
        409,
        "ROUTER_IN_USE",
        `Router masih dipakai: ${usage.pelanggan} pelanggan, ${usage.alert} alert, ${usage.logJaringan} log jaringan.`,
      );
    }
    if (inUse) {
      await tx.delete(networkLogs).where(eq(networkLogs.routerId, id));
      await tx.delete(alerts).where(eq(alerts.routerId, id));
      await tx.delete(customers).where(eq(customers.routerId, id));
    }
    const [deleted] = await tx.delete(routers).where(eq(routers.id, id)).returning({ id: routers.id });
    if (!deleted) {
      throw new ApiError(404, "ROUTER_NOT_FOUND", "Router tidak ditemukan.");
    }
    return { ok: true, id: deleted.id, removed: usage };
  });
}
