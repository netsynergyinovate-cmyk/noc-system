import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiPermission, readJson, ApiError } from "@/lib/api";
import { discoverRouters } from "@/services/router-discovery";

const bodySchema = z.object({ cidr: z.string().trim().max(32).optional() });

// Mencari kandidat alamat router MikroTik dari server NOC: gateway server, tetangga ARP bermerek MikroTik, dan
// (opsional) satu rentang privat <= /24 yang disebut operator. Tanpa kredensial; hanya peran router:manage karena
// server memindai jaringannya sendiri atas permintaan pemanggil.
export const POST = (request: Request) =>
  withApiPermission(request, { router: ["manage"] }, async () => {
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "Rentang jaringan tidak valid.");
    try {
      return NextResponse.json({ success: true, data: await discoverRouters(parsed.data.cidr || undefined) });
    } catch (err) {
      throw new ApiError(422, "INVALID_RANGE", err instanceof Error ? err.message : "Rentang tidak valid.");
    }
  });
