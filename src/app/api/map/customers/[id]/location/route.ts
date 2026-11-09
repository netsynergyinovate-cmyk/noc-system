import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { updateCustomerLocationSchema } from "@/validators/customer-location";
import {
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
          {
            ok: false,
            error: `Titik pelanggan '${id}' tidak ditemukan di sistem peta.`,
          },
          { status: 404 },
        );
      }

      return NextResponse.json({
        ok: true,
        data,
      });
    } catch (err) {
      console.error("[GET MAP CUSTOMER LOCATION ERROR]", err);
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

      const parsed = updateCustomerLocationSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: "Format koordinat lokasi pelanggan tidak valid.",
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
        success: true,
        data: updated,
        message: `Koreksi posisi koordinat pelanggan '${updated.name}' berhasil disimpan.`,
      });
    } catch (err) {
      console.error("[PATCH MAP CUSTOMER LOCATION ERROR]", err);
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
