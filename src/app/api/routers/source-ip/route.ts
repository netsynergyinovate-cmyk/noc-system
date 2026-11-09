import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiPermission, readJson, ApiError } from "@/lib/api";
import { DeviceConnectionError, sanitizeHost } from "@/lib/device-connection";
import { sourceIpFor } from "@/services/router-discovery";

const bodySchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535).optional(),
});

// Alamat sumber yang dipakai server NOC untuk menuju host router (tanpa mengirim paket apa pun), agar operator
// bisa menuliskannya persis di /ip service ... address=. Hanya peran router:manage.
export const POST = (request: Request) =>
  withApiPermission(request, { router: ["manage"] }, async () => {
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success)
      throw new ApiError(422, "VALIDATION_ERROR", "Isi host dengan benar.");
    let url: URL;
    try {
      url = sanitizeHost(parsed.data.host, parsed.data.port);
    } catch (err) {
      if (err instanceof DeviceConnectionError && err.code === "INVALID_HOST") {
        throw new ApiError(422, "INVALID_HOST", err.message);
      }
      throw err;
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const port = Number(url.port || 80);
    return NextResponse.json({
      success: true,
      data: { host, port, sourceIp: await sourceIpFor(host, port) },
    });
  });
