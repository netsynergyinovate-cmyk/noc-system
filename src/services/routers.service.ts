import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { impliesTls, sanitizeHost, storedRouterHost } from "@/lib/device-connection";
import { MikrotikRestClient } from "@/lib/mikrotik/client";
import { routers } from "@/db/schema";
import { CreateRouterInput } from "@/validators/routers";
import { encryptAES256GCM } from "@/lib/encryption";

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
