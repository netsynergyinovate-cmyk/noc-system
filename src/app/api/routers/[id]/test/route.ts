import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { routers } from "@/db/schema";
import { ApiError, withApiPermission } from "@/lib/api";
import { decryptAES256GCM } from "@/lib/encryption";
import { recordAudit } from "@/services/audit.service";
import { recordClientTestResult } from "@/services/device-test-results.service";
import { probeRouterApi } from "@/services/router-api-test.service";
import { oltIdSchema as uuidSchema } from "@/validators/devices";

export const runtime = "nodejs";

// Server menghubungi host router tersimpan (lewat backend Go): butuh
// router:manage. Kredensial dibaca dari database, jadi operator tidak perlu
// mengetik ulang; semua angka berasal dari router nyata.
export const POST = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  withApiPermission(request, { router: ["manage"] }, async (session) => {
    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) {
      throw new ApiError(404, "ROUTER_NOT_FOUND", "Router tidak ditemukan.");
    }
    const [router] = await db.select().from(routers).where(eq(routers.id, id)).limit(1);
    if (!router) throw new ApiError(404, "ROUTER_NOT_FOUND", "Router tidak ditemukan.");

    let password: string;
    try {
      password = decryptAES256GCM(router.passwordEnc);
    } catch {
      throw new ApiError(422, "DECRYPT_FAILED", "Gagal mendekripsi kata sandi router dari database.");
    }
    if (!password) {
      throw new ApiError(422, "NO_CREDENTIALS", "Kata sandi router tidak tersedia di database.");
    }

    // Pre-flight 5 detik di backend Go; mendukung REST maupun API biner.
    const probe = await probeRouterApi({
      host: router.host,
      protocol: router.protocol,
      username: router.username,
      password,
      timeoutMs: 5000,
    });

    const result = await recordClientTestResult({
      type: "mikrotik",
      mode: "real",
      raw: {
        ok: probe.ok,
        message: probe.message,
        code: probe.code,
        latencyMs: probe.latencyMs,
        endpointTested: probe.endpointTested,
        ...(probe.resource && {
          data: {
            version: probe.resource.version,
            cpuLoad: probe.resource.cpuLoad,
            uptime: probe.resource.uptime,
            boardName: probe.resource.boardName,
            freeMemory: probe.resource.freeMemory,
            totalMemory: probe.resource.totalMemory,
          },
        }),
      },
      host: router.host,
      port: probe.port,
      tls: probe.tls,
      username: router.username,
      password,
      testedBy: session.user.name || session.user.email,
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
