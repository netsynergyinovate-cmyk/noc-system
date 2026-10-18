import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { updateCustomerLocationSchema } from "@/validators/customer-location";
import {
  clearCustomerLocation,
  getCustomerCoordinates,
  updateCustomerLocation,
} from "@/services/customer-location.service";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async () => {
    try {
      const { id } = await params;
      const data = await getCustomerCoordinates(id);

      if (!data) {
        return NextResponse.json(
          { ok: false, error: `Pelanggan dengan ID '${id}' tidak ditemukan.` },
          { status: 404 },
        );
      }

      return NextResponse.json({
        ok: true,
        data,
      });
    } catch (err) {
      console.error("[GET CUSTOMER LOCATION ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, error: msg },
        { status: 500 },
      );
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

      const parsed = updateCustomerLocationSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: "Format koordinat tidak valid.",
            details: parsed.error.format(),
          },
          { status: 400 },
        );
      }

      const updated = await updateCustomerLocation(
        id,
        parsed.data,
        session.user.id,
      );

      return NextResponse.json({
        ok: true,
        data: updated,
        message: `Posisi titik pelanggan '${updated.name}' berhasil diperbarui di peta dan database.`,
      });
    } catch (err) {
      console.error("[PATCH CUSTOMER LOCATION ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("tidak ditemukan") ? 404 : 500;
      return NextResponse.json(
        { ok: false, error: msg },
        { status },
      );
    }
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async (session) => {
    try {
      const { id } = await params;
      const result = await clearCustomerLocation(id, session.user.id);
      return NextResponse.json({
        ok: true,
        message: `Titik koordinat pelanggan '${result.name}' berhasil dihapus dari peta.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("tidak ditemukan") ? 404 : 500;
      return NextResponse.json({ ok: false, error: msg }, { status });
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

