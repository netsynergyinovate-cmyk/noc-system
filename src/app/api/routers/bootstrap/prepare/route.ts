import { NextResponse } from "next/server";
import * as z from "zod";
import { withApiPermission, readJson, ApiError } from "@/lib/api";
import { DeviceConnectionError, sanitizeHost } from "@/lib/device-connection";
import { outboundSourceIp } from "@/services/outbound-source-ip";

export const runtime = "nodejs";

const bodySchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).optional(),
});

async function publicIp(): Promise<string | null> {
  try {
    const res = await fetch("https://api.ipify.org", {
      signal: AbortSignal.timeout(3000),
    });
    const text = (await res.text()).trim();
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(text) ? text : null;
  } catch {
    return null;
  }
}

// Tanpa nilai bawaan: port API diuji satu per satu (TCP), dan alamat server hanya kandidat sisi server.
// Alamat yang dilihat router (NAT/PPPoE) bisa berbeda; itu baru terverifikasi setelah login berhasil.
export const POST = (request: Request) =>
  withApiPermission(request, { router: ["manage"] }, async () => {
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success)
      throw new ApiError(422, "VALIDATION_ERROR", "Check the supplied fields.");
    let url: URL;
    try {
      url = sanitizeHost(parsed.data.host, parsed.data.port);
    } catch (err) {
      if (err instanceof DeviceConnectionError)
        throw new ApiError(422, err.code, err.message);
      throw err;
    }
    const candidates = [
      ...new Set(
        [
          parsed.data.port ?? (Number(url.port) || undefined),
          8728,
          8729,
        ].filter((p): p is number => !!p),
      ),
    ];
    const [probes, pub] = await Promise.all([
      Promise.all(
        candidates.map(async (port) => ({
          port,
          localIp: await outboundSourceIp(url.hostname, port, 2500),
        })),
      ),
      publicIp(),
    ]);
    return NextResponse.json({
      success: true,
      data: {
        ports: probes.map((p) => ({
          port: p.port,
          open: p.localIp !== null,
          localIp: p.localIp,
        })),
        publicIp: pub,
      },
    });
  });
