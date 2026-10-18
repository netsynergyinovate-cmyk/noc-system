import { NextResponse } from "next/server";
import { readJson, withApiPermission, withApiSession } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { getRouterById, updateRouter, deleteRouter } from "@/services/routers.service";
import { updateRouterSchema } from "@/validators/routers";
import { oltIdSchema as uuidSchema } from "@/validators/devices";
import { ApiError } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async () => {
    const { id } = await params;
    if (!uuidSchema.safeParse(id).success) {
      throw new ApiError(404, "ROUTER_NOT_FOUND", "Router tidak ditemukan.");
    }
    const router = await getRouterById(id);
    return NextResponse.json({ data: router });
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const audit = withAudit({
    action: "router-updated",
    getTarget: () => request.url,
  });

  return withApiPermission(
    request,
    { router: ["manage"] },
    audit(request, async () => {
      const { id } = await params;
      if (!uuidSchema.safeParse(id).success) {
        throw new ApiError(404, "ROUTER_NOT_FOUND", "Router tidak ditemukan.");
      }
      const raw = await readJson(request);
      const input = updateRouterSchema.parse(raw);
      const updated = await updateRouter(id, input);
      return NextResponse.json({ data: updated });
    }),
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const audit = withAudit({
    action: "router-deleted",
    getTarget: () => request.url,
  });

  return withApiPermission(
    request,
    { router: ["manage"] },
    audit(request, async () => {
      const { id } = await params;
      if (!uuidSchema.safeParse(id).success) {
        throw new ApiError(404, "ROUTER_NOT_FOUND", "Router tidak ditemukan.");
      }
      const result = await deleteRouter(id);
      return NextResponse.json({ ok: true, data: result });
    }),
  );
}

