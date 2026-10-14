import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { routers } from "@/db/schema";
import { ApiError, withApiPermission } from "@/lib/api";
import { DeviceConnectionError } from "@/lib/device-connection";
import { env } from "@/lib/env";
import { decryptAES256GCM } from "@/lib/encryption";
import { MikrotikRestClient } from "@/lib/mikrotik/client";
import { recordAudit } from "@/services/audit.service";
import { recordClientTestResult } from "@/services/device-test-results.service";
import { oltIdSchema as uuidSchema } from "@/validators/devices";

export const runtime = "nodejs";

// Server menghubungi host router tersimpan: butuh router:manage.
export const POST = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  withApiPermission(request, { router: ["manage"] }, async (session) => {
    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) {
      throw new ApiError(404, "ROUTER_NOT_FOUND", "Router tidak ditemukan.");
    }
    const [router] = await db.select().from(routers).where(eq(routers.id, id)).limit(1);
    if (!router) throw new ApiError(404, "ROUTER_NOT_FOUND", "Router tidak ditemukan.");

    let password: string | undefined;
    try {
      password = decryptAES256GCM(router.passwordEnc);
    } catch {
      password = env.MIKROTIK_REST_PASSWORD; // fallback kredensial env
    }
    if (!password) {
      throw new ApiError(422, "NO_CREDENTIALS", "Kata sandi router tidak tersedia.");
    }

    let client: MikrotikRestClient;
    try {
      // TLS dan port dibaca klien dari host tersimpan ("https://h:p", "h:443", dst).
      client = new MikrotikRestClient({
        host: router.host,
        username: router.username,
        password,
        mode: "real",
      });
    } catch (err) {
      if (err instanceof DeviceConnectionError && err.code === "INVALID_HOST") {
        throw new ApiError(422, "INVALID_HOST", err.message);
      }
      throw err;
    }

    // Gagal koneksi = HTTP 200 dengan ok=false; hasil tetap disimpan.
    const raw = await client.testConnection();
    const { host, port, tls } = client.target;
    const testedBy = session.user.name || session.user.email;
    const result = await recordClientTestResult({
      type: "mikrotik",
      mode: "real",
      raw,
      host,
      port,
      tls,
      username: router.username,
      password,
      testedBy,
      deviceId: router.id,
    });

    if (result.ok) {
      await db.update(routers).set({ lastSeenAt: new Date() }).where(eq(routers.id, router.id));
    }
    await recordAudit({
      userId: session.user.id,
      action: "router-connection-tested",
      target: `/api/routers/${router.id}`,
      detail: { routerId: router.id, ok: result.ok, code: result.code, latencyMs: result.latencyMs },
    });

    return NextResponse.json({ success: true, data: result });
  });
