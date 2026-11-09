import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { resolveScanTarget, scanTelnetPorts } from "@/lib/olt/telnet-port-scan";
import { parseTarget } from "@/services/device-connection-tester";

export const runtime = "nodejs";

const bodySchema = z.object({ host: z.string().trim().min(1).max(253) });

// shortcut: pembatas dalam memori per proses; ganti ke penyimpanan bersama bila server dijalankan multi-instance.
const MAX_SCANS = 5;
const WINDOW_MS = 60_000;
const recent = new Map<string, number[]>();
function allowScan(userId: string): boolean {
  const now = Date.now();
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  const allowed = hits.length < MAX_SCANS;
  recent.set(userId, allowed ? [...hits, now] : hits);
  return allowed;
}

// Mencari port telnet OLT dari server NOC untuk operator yang tidak tahu port forward-nya. Tanpa kredensial dan
// tanpa mengirim data ke perangkat. Peran router:manage, sama seperti POST /api/olts. Nama host di-resolve sekali
// dan yang dipindai adalah IP hasilnya (anti DNS rebinding); loopback, link-local, dan multicast ditolak.
export const POST = (request: Request) =>
  withApiPermission(request, { router: ["manage"] }, async (session) => {
    const parsed = bodySchema.safeParse(await readJson(request));
    const target = parsed.success ? parseTarget(parsed.data.host) : null;
    if (!target || target.port !== undefined || target.useTls !== undefined) {
      throw new ApiError(
        422,
        "INVALID_HOST",
        "Isi alamat IP atau nama host OLT saja, tanpa port atau http://.",
      );
    }
    if (!allowScan(session.user.id)) {
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "Terlalu sering mencari port. Tunggu sebentar lalu coba lagi.",
      );
    }
    let ip: string;
    try {
      ip = await resolveScanTarget(target.host);
    } catch (e) {
      const msg =
        e instanceof Error && e.message.startsWith("Alamat")
          ? e.message
          : "Host tidak ditemukan. Pastikan alamat OLT benar.";
      throw new ApiError(422, "INVALID_HOST", msg);
    }
    return NextResponse.json({
      success: true,
      data: await scanTelnetPorts(ip),
    });
  });
