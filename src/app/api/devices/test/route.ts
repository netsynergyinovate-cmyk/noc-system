import { NextResponse } from "next/server";
import { withApiPermission, readJson, ApiError } from "@/lib/api";
import { testDeviceConnection } from "@/services/device-connection.service";
import { testDeviceConnectionSchema } from "@/validators/devices";

export const runtime = "nodejs";

// Membuat SERVER menghubungi host dari pemanggil: wajib router:manage,
// diperiksa sebelum body dibaca dan sebelum ada koneksi keluar.
export const POST = (request: Request) =>
  withApiPermission(request, { router: ["manage"] }, async () => {
    const parsed = testDeviceConnectionSchema.safeParse(
      await readJson(request),
    );
    if (!parsed.success) {
      throw new ApiError(422, "VALIDATION_ERROR", "Check the supplied fields.");
    }
    const result = await testDeviceConnection(parsed.data);
    return NextResponse.json({ success: true, data: result });
  });
