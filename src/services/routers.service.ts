import "server-only";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import {
  impliesTls,
  runSimulatorDeviceTest,
  sanitizeHost,
  storedRouterHost,
} from "@/lib/device-connection";
import { assertNoSimulatorInProduction } from "@/lib/mode-switch";
import { alerts, customers, networkLogs, routers } from "@/db/schema";
import { CreateRouterInput, UpdateRouterInput } from "@/validators/routers";
import { encryptAES256GCM, decryptAES256GCM } from "@/lib/encryption";
import { probeRouterApi } from "@/services/router-api-test.service";
import type { RouterProtocol } from "@/db/schema/routers";

// Pre-flight PRD: uji koneksi maksimal 5 detik, lalu simpan hanya bila lulus.
const PREFLIGHT_TIMEOUT_MS = 5000;
const API_PORTS = new Set([8728, 8729]);

function protocolFor(
  input: { protocol?: RouterProtocol },
  url: URL,
): RouterProtocol {
  if (input.protocol) return input.protocol;
  return API_PORTS.has(url.port ? Number(url.port) : 0) ? "api" : "rest";
}

// Protokol API selalu memakai port 8728/8729. Bila operator memilih API tetapi
// port masih 80/443 (bawaan layanan www), arahkan ke port API yang setara
// daripada gagal terhubung ke layanan yang salah.
function normalizeApiUrl(url: URL, useSsl: boolean) {
  const port = url.port ? Number(url.port) : undefined;
  if (port === undefined || port === 80 || port === 443 || port === 8443) {
    url.port = String(useSsl || port === 443 || port === 8443 ? 8729 : 8728);
  }
}

// Kebalikannya: router yang pindah dari API ke REST tidak boleh tetap memakai
// port 8728/8729 (REST tidak menjawab di sana). Mengembalikan true bila HTTPS
// harus dipaksa (padanan 8729).
function normalizeRestUrl(url: URL): boolean {
  const port = url.port ? Number(url.port) : undefined;
  if (port === 8728) {
    url.port = "";
    return false;
  }
  if (port === 8729) {
    url.port = "443";
    return true;
  }
  return false;
}

// Melempar ApiError bila router tidak lolos uji. Mode simulator hanya boleh di
// lingkungan non-produksi (PRD: hilangkan fallback simulator di produksi).
async function assertReachable(opts: {
  host: string;
  port?: number;
  protocol: RouterProtocol;
  useSsl: boolean;
  username: string;
  password: string;
  mode?: "real" | "simulator";
}) {
  const mode =
    opts.mode ?? (env.DASHBOARD_DATA === "demo" ? "simulator" : "real");
  if (mode === "simulator") {
    assertNoSimulatorInProduction("mikrotik");
    const result = runSimulatorDeviceTest({
      type: "mikrotik",
      mode: "simulator",
      host: opts.host,
      port: opts.port,
    });
    if (!result.ok)
      throw new ApiError(
        400,
        result.code ?? "CONNECTION_FAILED",
        result.message,
      );
    return;
  }
  const result = await probeRouterApi({
    host: opts.host,
    port: opts.port,
    protocol: opts.protocol,
    useSsl: opts.useSsl,
    username: opts.username,
    password: opts.password,
    timeoutMs: PREFLIGHT_TIMEOUT_MS,
  });
  if (!result.ok) throw new ApiError(400, result.code, result.message);
}

// Kolom router yang boleh sampai ke klien. `passwordEnc` (kata sandi router
// yang dienkripsi) sengaja tidak ada: ia tidak boleh keluar dari server,
// terenkripsi sekalipun. Dipilih di SQL (`returning`), bukan dibuang di route,
// supaya tidak ada pemanggil yang bisa lupa menyaringnya.
const publicRouterColumns = {
  id: routers.id,
  name: routers.name,
  host: routers.host,
  username: routers.username,
  protocol: routers.protocol,
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
  let protocol: RouterProtocol;
  let url: URL;
  let useSsl: boolean;
  try {
    url = sanitizeHost(input.host, input.port);
    protocol = protocolFor(input, url);
    useSsl = input.useSsl ?? impliesTls(url);
    if (protocol === "api") normalizeApiUrl(url, useSsl);
    else if (normalizeRestUrl(url)) useSsl = true;
    normalizedHost = storedRouterHost(url, useSsl);
  } catch (e) {
    throw new ApiError(422, "INVALID_HOST", (e as Error).message);
  }

  const [dup] = await db
    .select({ id: routers.id })
    .from(routers)
    .where(eq(routers.host, normalizedHost))
    .limit(1);
  if (dup)
    throw new ApiError(
      409,
      "DUPLICATE_HOST",
      "Router dengan host ini sudah terdaftar.",
    );

  // Pre-flight: pastikan router bisa dihubungi sebelum disimpan.
  if (input.validateConnection !== false) {
    await assertReachable({
      host: normalizedHost,
      port: url.port ? Number(url.port) : undefined,
      protocol,
      useSsl,
      username: input.username,
      password: input.password,
      mode: input.mode,
    });
  }

  const encryptedPassword = encryptAES256GCM(input.password);

  const [router] = await db
    .insert(routers)
    .values({
      name: input.name,
      host: normalizedHost,
      username: input.username,
      passwordEnc: encryptedPassword,
      protocol,
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
      protocol: routers.protocol,
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
    protocol: RouterProtocol;
    status: "aktif" | "nonaktif";
    lastSeenAt: Date | null;
  }> = {};

  if (input.name) updates.name = input.name;
  if (input.status) updates.status = input.status;
  if (input.username) updates.username = input.username;

  let targetHost = existing.host;
  let targetProtocol = input.protocol ?? existing.protocol;
  let targetPort: number | undefined;
  let targetUseSsl = false;
  if (
    input.host ||
    input.protocol ||
    input.port !== undefined ||
    input.useSsl !== undefined
  ) {
    try {
      const url = sanitizeHost(input.host ?? existing.host, input.port);
      targetProtocol = protocolFor(
        { protocol: input.protocol ?? existing.protocol },
        url,
      );
      targetUseSsl = input.useSsl ?? impliesTls(url);
      if (targetProtocol === "api") normalizeApiUrl(url, targetUseSsl);
      else if (normalizeRestUrl(url)) targetUseSsl = true;
      targetPort = url.port ? Number(url.port) : undefined;
      targetHost = storedRouterHost(url, targetUseSsl);
      updates.host = targetHost;
      updates.protocol = targetProtocol;
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
        throw new ApiError(
          409,
          "DUPLICATE_HOST",
          "Router dengan host ini sudah terdaftar.",
        );
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
    await assertReachable({
      host: targetHost,
      port: targetPort,
      protocol: targetProtocol,
      useSsl: targetUseSsl,
      username: targetUsername,
      password: targetPassword,
      mode: input.mode,
    });
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
export async function deleteRouter(
  id: string,
  { force = false }: { force?: boolean } = {},
) {
  return db.transaction(async (tx) => {
    const used = async (
      table: typeof customers | typeof alerts | typeof networkLogs,
    ) => {
      const [row] = await tx
        .select({ n: count() })
        .from(table)
        .where(eq(table.routerId, id));
      return row.n;
    };
    const usage = {
      pelanggan: await used(customers),
      alert: await used(alerts),
      logJaringan: await used(networkLogs),
    };
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
    const [deleted] = await tx
      .delete(routers)
      .where(eq(routers.id, id))
      .returning({ id: routers.id });
    if (!deleted) {
      throw new ApiError(404, "ROUTER_NOT_FOUND", "Router tidak ditemukan.");
    }
    return { ok: true, id: deleted.id, removed: usage };
  });
}
