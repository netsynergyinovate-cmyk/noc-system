import { NextResponse } from "next/server";
import { withApiPermission, readJson, ApiError } from "@/lib/api";
import { DeviceConnectionError } from "@/lib/device-connection";
import { MikrotikRestClient } from "@/lib/mikrotik/client";
import { redactSecrets } from "@/services/device-connection-tester";
import { recordClientTestResult } from "@/services/device-test-results.service";
import { testRouterSchema } from "@/validators/routers";
import { outboundSourceIp, tcpConnectedTimeoutMessage } from "@/services/outbound-source-ip";

// Endpoint ini membuat SERVER menghubungi host yang disebut pemanggil, jadi
// hanya peran dengan router:manage. Izin diperiksa lebih dulu: akun hanya-lihat
// mendapat 403 sebelum isi dibaca dan sebelum ada koneksi keluar.
export const POST = (request: Request) =>
  withApiPermission(request, { router: ["manage"] }, async (session) => {
    const body = await readJson(request);
    const parsed = testRouterSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, "VALIDATION_ERROR", "Check the supplied fields.");
    }

    let client: MikrotikRestClient;
    try {
      client = new MikrotikRestClient({ ...parsed.data, mode: parsed.data.mode ?? "real" });
    } catch (err) {
      // Host gagal sanitasi anti-SSRF (path, kredensial, skema selain http/https, dst).
      if (err instanceof DeviceConnectionError && err.code === "INVALID_HOST") {
        throw new ApiError(422, "INVALID_HOST", err.message);
      }
      throw err;
    }

    // Kegagalan koneksi bukan galat permintaan: HTTP 200 dengan ok=false,
    // bentuk sama seperti /api/devices/test.
    const raw = await client.testConnection();
    const secrets = { username: parsed.data.username, password: parsed.data.password };
    const result = { ...raw, message: redactSecrets(raw.message, secrets) };
    // Tujuan akhir yang benar-benar dihubungi (skema/port sudah disimpulkan klien).
    const { host, port, tls, endpoint } = client.target;
    // Alamat sumber server ke router: hanya berguna saat gagal (allow-list router). Mode simulator tidak punya jaringan.
    const sourceIp = !result.ok && (parsed.data.mode ?? "real") === "real" ? await outboundSourceIp(host, port) : null;
    // TCP tersambung tetapi tidak ada jawaban HTTP sampai timeout: hampir pasti bukan layanan REST (Winbox/API/lainnya).
    const message = result.code === "TIMEOUT" && sourceIp ? tcpConnectedTimeoutMessage(host, port) : result.message;

    // Riwayat uji disimpan walau gagal; password sudah disaring (recordClientTestResult).
    await recordClientTestResult({
      type: "mikrotik",
      mode: parsed.data.mode ?? "real",
      raw: result,
      host,
      port,
      tls,
      username: parsed.data.username,
      password: parsed.data.password,
      testedBy: session.user.name || session.user.email,
    });

    // Kunci RouterOS (version, cpu-load, ...) tetap ada agar klien lama tidak rusak.
    // Nilainya hanya dari router; bila gagal tidak ada angka karangan.
    return NextResponse.json({
      success: true,
      data: {
        ok: result.ok,
        status: result.status ?? (result.ok ? "connected" : "error"),
        code: result.code ?? (result.ok ? "OK" : "HTTP_ERROR"),
        statusCode: result.statusCode,
        message,
        latencyMs: result.latencyMs,
        endpointTested: result.endpointTested ?? endpoint,
        timestamp: result.timestamp ?? Math.floor(Date.now() / 1000),
        version: result.resource?.version,
        "cpu-load": result.resource?.cpuLoad,
        uptime: result.resource?.uptime,
        "board-name": result.resource?.boardName,
        sourceIp,
      },
      result,
    });
  });
