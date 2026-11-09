import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { createRouteSchema } from "@/validators/route";
import { createRoute, listRoutes } from "@/services/route.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const routes = await listRoutes();
      return NextResponse.json({ ok: true, data: routes });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  return withApiSession(request, async () => {
    try {
      const body = await request.json().catch(() => null);
      const parsed = createRouteSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: "Data jalur tidak valid.",
            details: parsed.error.format(),
          },
          { status: 400 },
        );
      }
      const route = await createRoute(parsed.data);
      return NextResponse.json({ ok: true, data: route });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}
