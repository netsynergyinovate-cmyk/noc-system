import { NextResponse } from "next/server";
import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { DeviceConnectionError } from "@/lib/device-connection";
import { HsgqClient } from "@/lib/olt/hsgq-client";
import { redactSecrets } from "@/services/device-connection-tester";
import { recordClientTestResult } from "@/services/device-test-results.service";
import { testOltSchema } from "@/validators/devices";

export const runtime = "nodejs";

// Server menghubungi host pemanggil: izin diperiksa sebelum body dibaca.
export const POST = (request: Request) =>
  withApiPermission(request, { router: ["manage"] }, async (session) => {
    const parsed = testOltSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new ApiError(422, "VALIDATION_ERROR", "Periksa kembali data yang dikirim.");
    }

    let client: HsgqClient;
    try {
      client = new HsgqClient(parsed.data);
    } catch (err) {
      // Host gagal sanitasi anti-SSRF (path, kredensial, skema, dst).
      if (err instanceof DeviceConnectionError && err.code === "INVALID_HOST") {
        throw new ApiError(422, "INVALID_HOST", err.message);
      }
      throw err;
    }

    // Kegagalan koneksi bukan galat permintaan: HTTP 200 dengan ok=false.
    const raw = await client.testConnection();
    const result = {
      ...raw,
      message: redactSecrets(raw.message, { username: parsed.data.username, password: parsed.data.password }),
    };

    // Riwayat uji disimpan walau gagal; password sudah disaring (recordClientTestResult).
    await recordClientTestResult({
      type: "olt",
      mode: parsed.data.mode,
      raw: result,
      host: parsed.data.host,
      port: parsed.data.port,
      username: parsed.data.username,
      password: parsed.data.password,
      testedBy: session.user.name || session.user.email,
    });

    return NextResponse.json({
      success: true,
      data: {
        ok: result.ok,
        status: result.status ?? (result.ok ? "connected" : "error"),
        code: result.code ?? (result.ok ? "OK" : "HTTP_ERROR"),
        statusCode: result.statusCode,
        message: result.message,
        latencyMs: result.latencyMs,
        endpointTested:
          result.endpointTested ?? `GET http://${parsed.data.host}:${parsed.data.port}/api/v1/system`,
        timestamp: result.timestamp ?? Math.floor(Date.now() / 1000),
        model: result.data?.model ?? "HSGQ-XPON-8",
        firmware: result.data?.firmware ?? "V2.1.5",
        uptime: result.data?.uptime,
        ponPortCount: result.data?.ponPortCount ?? 8,
      },
      result,
    });
  });
