import * as z from "zod";
import { ApiError } from "@/lib/api";
import { DeviceConnectionError, sanitizeHost } from "@/lib/device-connection";
import { RouterOsApiError, type RouterOsConn } from "@/lib/mikrotik/api-client";
import { redactSecrets } from "@/services/device-connection-tester";
import { outboundSourceIp } from "@/services/outbound-source-ip";

export const connectionSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).optional(),
  tls: z.boolean().optional(),
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
});

export type ConnectionInput = z.infer<typeof connectionSchema>;

// Anti-SSRF: host disaring sanitizeHost seperti /api/routers/test.
export function toConn(c: ConnectionInput): RouterOsConn {
  const defaultPort = c.tls ? 8729 : 8728;
  try {
    const url = sanitizeHost(c.host, c.port);
    return {
      host: url.hostname,
      port: Number(url.port) || defaultPort,
      tls: c.tls,
      username: c.username,
      password: c.password,
    };
  } catch (err) {
    if (err instanceof DeviceConnectionError)
      throw new ApiError(422, err.code, err.message);
    throw err;
  }
}

// Galat API router -> hasil ok:false. Untuk kegagalan jaringan, sertakan alamat sumber server
// (sisi server; NAT di jalur bisa membuat router melihat alamat lain) agar allow-list api bisa diisi tanpa menebak.
export async function failure(
  err: unknown,
  c: ConnectionInput,
  conn: RouterOsConn,
) {
  if (!(err instanceof RouterOsApiError)) return null;
  let message = redactSecrets(err.message, c);
  if (err.code === "AUTH_FAILED") {
    message = /radius/i.test(message)
      ? "Login ditolak: login router memakai RADIUS; pakai akun lokal admin."
      : `Login ditolak: ${message}`;
  } else if (err.code === "TRAP" && /permission/i.test(message)) {
    message = `${message}. Pakai akun dari grup full.`;
  }
  const network =
    err.code === "NETWORK_ERROR" ||
    err.code === "TIMEOUT" ||
    err.code === "CONNECTION_REFUSED";
  const sourceIp = network
    ? await outboundSourceIp(conn.host, conn.port ?? 8728)
    : null;
  return { ok: false as const, code: err.code, message, sourceIp };
}
