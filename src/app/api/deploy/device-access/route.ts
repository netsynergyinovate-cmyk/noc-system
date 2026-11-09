import { withApiPermission } from "@/lib/api";
import {
  evaluateDeployAccess,
  deployGuardResponse,
} from "@/lib/deploy/role-guard";
import {
  getDeployTarget,
  updateDeviceAccessLevel,
} from "@/services/deploy-targets.service";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({
  level: z.enum(["simulator", "baca-saja", "penuh"]),
});

export async function POST(request: Request) {
  const guard = evaluateDeployAccess(request);
  const denied = deployGuardResponse(guard);
  if (denied) return denied;

  return withApiPermission(request, { system: ["manage"] }, async () => {
    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return Response.json(
        {
          error:
            "Tingkat akses tidak valid (pilih simulator, baca-saja, atau penuh).",
        },
        { status: 400 },
      );
    }

    const target = await getDeployTarget();
    if (!target) {
      return Response.json(
        { error: "Target SERVER NATIVE belum dikonfigurasi." },
        { status: 400 },
      );
    }

    const updated = await updateDeviceAccessLevel(target.id, parsed.data.level);

    return Response.json({
      ok: true,
      data: updated,
      message: `Tingkat akses perangkat berhasil diubah ke: ${parsed.data.level}`,
    });
  });
}
