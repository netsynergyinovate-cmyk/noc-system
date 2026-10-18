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
          { ok: false, error: "ID pelanggan peta wajib disertakan." },
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
            error: `Titik pelanggan '${id}' tidak ditemukan di sistem peta.`,
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
      console.error("[GET MAP CUSTOMER DETAIL ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, error: msg },
        { status: 500 },
      );
    }
  });
}
