import { NextResponse } from "next/server";
import { ApiError, withApiSession } from "@/lib/api";
import { MikrotikRestClient } from "@/lib/mikrotik/client";
import { getRouterDecryptedCredentials } from "@/services/device-credentials.service";

export const runtime = "nodejs";

// Baca kolom address= layanan RouterOS lewat backend Go (satu gateway).
// Dipakai notifikasi untuk menyusun perintah allow-list versi TAMBAH.
export const GET = (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) =>
  withApiSession(request, async () => {
    const { id } = await params;
    const service = new URL(request.url).searchParams.get("name");
    if (service !== "www" && service !== "api") {
      throw new ApiError(422, "VALIDATION_ERROR", "name harus www atau api.");
    }
    const creds = await getRouterDecryptedCredentials(id);
    if (!creds)
      throw new ApiError(404, "ROUTER_NOT_FOUND", "Router tidak ditemukan.");

    const client = new MikrotikRestClient({
      host: creds.host,
      port: creds.port,
      useSsl: creds.useTls,
      username: creds.username,
      password: creds.password,
      routerId: id,
      mode: "real",
    });
    const rows = await client.read("/rest/ip/service", { name: service });
    const first = Array.isArray(rows)
      ? (rows[0] as { address?: unknown } | undefined)
      : undefined;
    const address = typeof first?.address === "string" ? first.address : "";
    return NextResponse.json({ data: { address } });
  });
