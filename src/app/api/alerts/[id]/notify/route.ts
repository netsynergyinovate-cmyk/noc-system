import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { notifyAlertWhatsapp } from "@/services/alerts.service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export function POST(request: Request, context: Context) {
  return withApiSession(request, async () => {
    const { id } = await context.params;
    const result = await notifyAlertWhatsapp(id);
    if (!result.ok)
      return NextResponse.json(
        { error: "not_found", message: "Alert tidak ditemukan." },
        { status: 404 },
      );
    return NextResponse.json({
      ok: true,
      sent: result.sent,
      failed: result.failed,
    });
  });
}
