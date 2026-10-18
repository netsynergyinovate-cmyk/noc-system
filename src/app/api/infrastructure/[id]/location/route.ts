import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { updateInfrastructureLocationSchema } from "@/validators/infrastructure-placement";
import {
  getInfrastructureDetail,
  updateInfrastructureLocation,
} from "@/services/map-infrastructure.service";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async () => {
    try {
      const { id } = await params;
      const url = new URL(request.url);
      const forceMock =
        url.searchParams.get("forceMock") === "true" ||
        url.searchParams.get("mode") === "mock";

      const detail = await getInfrastructureDetail(id, { forceMock });

      if (!detail) {
        return NextResponse.json(
          {
            ok: false,
            error: `Perangkat infrastruktur dengan ID atau nama '${id}' tidak ditemukan.`,
          },
          { status: 404 },
        );
      }

      return NextResponse.json({
        ok: true,
        success: true,
        data: {
          id: detail.device.id,
          name: detail.device.name,
          type: detail.device.type,
          latitude: detail.device.latitude,
          longitude: detail.device.longitude,
          address: detail.device.address,
        },
      });
    } catch (err) {
      console.error("[GET INFRASTRUCTURE LOCATION ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async (session) => {
    try {
      const { id } = await params;
      const body = await request.json().catch(() => null);
      const parsed = updateInfrastructureLocationSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: "Format koordinat perangkat tidak valid.",
            details: parsed.error.format(),
          },
          { status: 400 },
        );
      }

      const updated = await updateInfrastructureLocation(
        id,
        parsed.data,
        session.user.id,
      );

      return NextResponse.json({
        ok: true,
        success: true,
        data: updated,
        message: "Posisi perangkat infrastruktur berhasil diperbarui di peta.",
      });
    } catch (err) {
      console.error("[PATCH INFRASTRUCTURE LOCATION ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return PATCH(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return PATCH(request, context);
}
