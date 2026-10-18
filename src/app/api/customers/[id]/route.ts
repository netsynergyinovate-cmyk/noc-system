import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { customerDetailQuerySchema } from "@/validators/customer-location";
import { getCustomerMapDetail } from "@/services/customer-location.service";

export const runtime = "nodejs";

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async () => {
    try {
      const { id } = await params;
      if (!id || id.trim().length === 0) {
        return NextResponse.json(
          { ok: false, error: "ID pelanggan wajib disertakan." },
          { status: 400 },
        );
      }

      const url = new URL(request.url);
      const rawParams = {
        forceMock:
          url.searchParams.get("forceMock") ??
          (url.searchParams.get("mode") === "mock" ? "true" : undefined),
      };

      const parsed = customerDetailQuerySchema.safeParse(rawParams);
      const data = await getCustomerMapDetail(id.trim(), {
        forceMock: parsed.success ? parsed.data.forceMock : false,
      });

      if (!data) {
        return NextResponse.json(
          {
            ok: false,
            error: `Pelanggan dengan identifikasi '${id}' tidak ditemukan di sistem.`,
          },
          { status: 404 },
        );
      }

      return NextResponse.json({
        ok: true,
        success: true,
        data,
        dataSource: data.dataSource,
      });
    } catch (err) {
      console.error("[GET CUSTOMER BY ID ERROR]", err);
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

      const { updateCustomerLocationSchema } = await import(
        "@/validators/customer-location"
      );
      const { updateCustomerLocation } = await import(
        "@/services/customer-location.service"
      );

      const parsed = updateCustomerLocationSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: "Format koordinat koreksi tidak valid.",
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
        message: `Koreksi koordinat pelanggan '${updated.name}' berhasil disimpan.`,
      });
    } catch (err) {
      console.error("[PATCH CUSTOMER BY ID ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("tidak ditemukan") ? 404 : 500;
      return NextResponse.json(
        { ok: false, error: msg },
        { status },
      );
    }
  });
}

