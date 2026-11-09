import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { olts } from "@/db/schema";
import { ApiError, withApiPermission } from "@/lib/api";
import { DeviceConnectionError } from "@/lib/device-connection";
import { decryptAES256GCM } from "@/lib/encryption";
import { HsgqClient } from "@/lib/olt/hsgq-client";
import { HSGQ_TELNET_DRIVER, testHsgqTelnetLogin } from "@/lib/olt/hsgq-telnet";
import { recordAudit } from "@/services/audit.service";
import { parseTarget } from "@/services/device-connection-tester";
import { recordClientTestResult } from "@/services/device-test-results.service";
import { oltIdSchema } from "@/validators/devices";

export const runtime = "nodejs";

// Server menghubungi host OLT tersimpan: butuh router:manage.
export const POST = (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) =>
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
      throw new ApiError(
        422,
        "DECRYPT_FAILED",
        "Gagal mendekripsi kata sandi OLT dari database.",
      );
    }
    if (!password) {
      throw new ApiError(
        422,
        "NO_CREDENTIALS",
        "Kata sandi OLT tidak tersedia di database.",
      );
    }

    const target = parseTarget(olt.host);
    const isTelnet = olt.driver === HSGQ_TELNET_DRIVER;
    const port = target?.port ?? (isTelnet ? 23 : 80);
    let raw: Awaited<ReturnType<HsgqClient["testConnection"]>>;
    if (isTelnet) {
      // OLT yang hanya punya CLI telnet: uji login CLI.
      const t = await testHsgqTelnetLogin({
        host: olt.host,
        username: olt.username,
        password,
      });
      raw = {
        ok: t.ok,
        message: t.message,
        code: t.code,
        latencyMs: t.latencyMs,
        endpointTested: `TELNET ${olt.host}`,
      } as typeof raw;
    } else {
      let client: HsgqClient;
      try {
        client = new HsgqClient({
          host: olt.host,
          port,
          username: olt.username,
          password,
          mode: "real",
        });
      } catch (err) {
        if (
          err instanceof DeviceConnectionError &&
          err.code === "INVALID_HOST"
        ) {
          throw new ApiError(422, "INVALID_HOST", err.message);
        }
        throw err;
      }
      // Gagal koneksi = HTTP 200 dengan ok=false; hasil tetap disimpan.
      raw = await client.testConnection();
    }
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
      await db
        .update(olts)
        .set({ lastSeenAt: new Date() })
        .where(eq(olts.id, olt.id));
    }
    await recordAudit({
      userId: session.user.id,
      action: "olt-connection-tested",
      target: `/api/olts/${olt.id}`,
      detail: {
        oltId: olt.id,
        ok: result.ok,
        code: result.code,
        latencyMs: result.latencyMs,
      },
    });

    return NextResponse.json({ success: true, data: result });
  });
