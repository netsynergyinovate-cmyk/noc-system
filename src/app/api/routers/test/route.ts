import { NextResponse } from "next/server";
import { withApiPermission, readJson, ApiError } from "@/lib/api";
import {
  DeviceConnectionError,
  runSimulatorDeviceTest,
  sanitizeHost,
} from "@/lib/device-connection";
import { redactSecrets } from "@/services/device-connection-tester";
import { recordClientTestResult } from "@/services/device-test-results.service";
import { testRouterSchema } from "@/validators/routers";
import { probeRouterApi } from "@/services/router-api-test.service";

// Endpoint ini memeriksa router yang disebut pemanggil. Izin diperiksa lebih
// dulu: akun hanya-lihat mendapat 403 sebelum ada koneksi keluar.
//
// Pre-flight produksi dijalankan backend Go (FR-02): REST maupun API biner,
// maksimal 5 detik, tanpa fallback sukses palsu. Mode simulator hanya dipakai
// bila diminta eksplisit (lingkungan demo).
export const POST = (request: Request) =>
  withApiPermission(request, { router: ["manage"] }, async (session) => {
    const body = await readJson(request);
    const parsed = testRouterSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(422, "VALIDATION_ERROR", "Check the supplied fields.");
    }
    const { host, port, username, password } = parsed.data;
    try {
      sanitizeHost(host, port);
    } catch (err) {
      if (err instanceof DeviceConnectionError && err.code === "INVALID_HOST") {
        throw new ApiError(422, "INVALID_HOST", err.message);
      }
      throw err;
    }
    const protocol = parsed.data.protocol ?? "rest";
    const mode = parsed.data.mode ?? "real";
    const secrets = { username, password: password ?? "" };
    let probe: Awaited<ReturnType<typeof probeRouterApi>> | null = null;
    if (mode === "simulator") {
      const sim = runSimulatorDeviceTest({
        type: "mikrotik",
        mode: "simulator",
        host,
        port,
      });
      probe = {
        ok: sim.ok,
        code: sim.ok ? "OK" : (sim.code ?? "CONNECTION_FAILED"),
        message: sim.message,
        latencyMs: sim.latencyMs ?? 0,
        port: port ?? (protocol === "api" ? 8728 : 80),
        tls: parsed.data.useSsl ?? false,
        endpointTested: `${protocol === "api" ? "API" : "GET"} ${host}`,
        groupCheck: null,
        resource: sim.ok
          ? {
              version: String(sim.data?.version ?? ""),
              cpuLoad: Number(sim.data?.cpuLoad ?? 0),
              uptime: String(sim.data?.uptime ?? ""),
              boardName: String(sim.data?.boardName ?? ""),
              freeMemory: 0,
              totalMemory: 0,
              architecture: "",
            }
          : undefined,
      };
    } else {
      probe = await probeRouterApi({
        host,
        port,
        protocol,
        useSsl: parsed.data.useSsl,
        username,
        password: password ?? "",
        timeoutMs: 5000,
      });
    }

    const message = redactSecrets(probe.message, secrets);
    // Alamat publik backend (dihitung Go). Tidak ada koneksi tambahan dari Next.js.
    const sourceIp = probe.ok ? null : (probe.sourceIp ?? null);

    // Riwayat uji disimpan walau gagal; password sudah disaring.
    await recordClientTestResult({
      type: "mikrotik",
      mode,
      raw: {
        ok: probe.ok,
        message,
        code: probe.code,
        latencyMs: probe.latencyMs,
        endpointTested: probe.endpointTested,
      },
      host,
      port: probe.port,
      tls: probe.tls,
      username,
      password,
      testedBy: session.user.name || session.user.email,
    });

    const resource = probe.resource;
    return NextResponse.json({
      success: true,
      data: {
        ok: probe.ok,
        status: probe.ok ? "connected" : "error",
        code: probe.code,
        message,
        latencyMs: probe.latencyMs,
        endpointTested: probe.endpointTested,
        timestamp: Math.floor(Date.now() / 1000),
        version: resource?.version,
        "cpu-load": resource?.cpuLoad,
        uptime: resource?.uptime,
        "board-name": resource?.boardName,
        sourceIp,
        localSourceIp: probe.localSourceIp ?? null,
        groupCheck: probe.groupCheck ?? null,
      },
      result: probe,
    });
  });
