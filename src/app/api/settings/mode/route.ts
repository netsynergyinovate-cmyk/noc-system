import { withApiSession } from "@/lib/api";
import {
  getRuntimeModeStatus,
  setRuntimeMode,
  type DataModeType,
} from "@/services/runtime-mode.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const hostHeader = request.headers.get("host");
    const status = await getRuntimeModeStatus(hostHeader);

    return Response.json({
      data: status,
    });
  });
}

export function POST(request: Request) {
  return withApiSession(request, async () => {
    let body: { dataMode?: DataModeType } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json(
        { error: "Payload JSON tidak valid" },
        { status: 400 },
      );
    }

    const targetMode = body.dataMode === "live" ? "live" : "demo";
    const hostHeader = request.headers.get("host");
    const updated = await setRuntimeMode(targetMode, hostHeader);

    return Response.json({
      data: updated,
      message:
        targetMode === "live"
          ? "Mode Live aktif: Semua data dummy ditiadakan dan diarahkan ke database PostgreSQL."
          : "Mode Simulasi aktif: Data tiruan digunakan untuk pengujian antarmuka.",
    });
  });
}
