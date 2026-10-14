import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { olts } from "@/db/schema";
import { ApiError, withApiPermission } from "@/lib/api";
import { DeviceConnectionError } from "@/lib/device-connection";
import { env } from "@/lib/env";
import { decryptAES256GCM } from "@/lib/encryption";
import { HsgqClient } from "@/lib/olt/hsgq-client";
import { recordAudit } from "@/services/audit.service";
import { parseTarget } from "@/services/device-connection-tester";
import { recordClientTestResult } from "@/services/device-test-results.service";
import { oltIdSchema } from "@/validators/devices";

export const runtime = "nodejs";

// Server menghubungi host OLT tersimpan: butuh router:manage.
export const POST = (request: Request, { params }: { params: Promise<{ id: string }> }) =>
  withApiPermission(request, { router: ["manage"] }, async (session) => {
    const { id } = await params;
    if (!oltIdSchema.safeParse(id).success) {
      throw new ApiError(404, "OLT_NOT_FOUND", "OLT tidak ditemukan.");
    }
    const [olt] = await db.select().from(olts).where(eq(olts.id, id)).limit(1);
    if (!olt) throw new ApiError(404, "OLT_NOT_FOUND", "OLT tidak ditemukan.");

    let password: string | undefined;
    try {
      password = decryptAES256GCM(olt.passwordEnc);
    } catch {
      password = env.OLT_HSGQ_PASSWORD; // fallback kredensial env
    }
    if (!password) {
      throw new ApiError(422, "NO_CREDENTIALS", "Kata sandi OLT tidak tersedia.");
    }

    const target = parseTarget(olt.host);
    const port = target?.port ?? 80;
    let client: HsgqClient;
    try {
      client = new HsgqClient({ host: olt.host, port, username: olt.username, password, mode: "real" });
    } catch (err) {
      if (err instanceof DeviceConnectionError && err.code === "INVALID_HOST") {
        throw new ApiError(422, "INVALID_HOST", err.message);
      }
      throw err;
    }

    // Gagal koneksi = HTTP 200 dengan ok=false; hasil tetap disimpan.
    const raw = await client.testConnection();
    const result = await recordClientTestResult({
      type: "olt",
      mode: "real",
      raw,
      host: target?.host ?? olt.host,
      port,
      username: olt.username,
      password,
      testedBy: session.user.name || session.user.email,
      deviceId: olt.id,
    });

    if (result.ok) {
      await db.update(olts).set({ lastSeenAt: new Date() }).where(eq(olts.id, olt.id));
    }
    await recordAudit({
      userId: session.user.id,
      action: "olt-connection-tested",
      target: `/api/olts/${olt.id}`,
      detail: { oltId: olt.id, ok: result.ok, code: result.code, latencyMs: result.latencyMs },
    });

    return NextResponse.json({ success: true, data: result });
  });
