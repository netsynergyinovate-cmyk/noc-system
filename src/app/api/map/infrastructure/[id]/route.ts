import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { updateInfrastructureLocationSchema } from "@/validators/infrastructure-placement";
import {
  updateInfrastructureLocation,
  deleteInfrastructurePoint,
  getInfrastructureDetail,
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
        data: detail,
      });
    } catch (err) {
      console.error("[GET MAP INFRASTRUCTURE DETAIL ERROR]", err);
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
        data: updated,
        message: "Posisi perangkat infrastruktur berhasil dipindahkan.",
      });
    } catch (err) {
      console.error("[PATCH INFRASTRUCTURE DEVICE LOCATION ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}

export const PUT = PATCH;

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async (session) => {
    try {
      const { id } = await params;
      const result = await deleteInfrastructurePoint(id, session.user.id);

      return NextResponse.json({
        ok: true,
        data: result,
        message: "Perangkat infrastruktur berhasil dihapus dari peta.",
      });
    } catch (err) {
      console.error("[DELETE INFRASTRUCTURE DEVICE ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}
