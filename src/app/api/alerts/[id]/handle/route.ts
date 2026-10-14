import { NextResponse } from "next/server";
import { withApiPermission } from "@/lib/api";
import { markAlertHandled } from "@/services/alerts.service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

// Menandai alert ditangani mengubah data bersama: butuh izin alert:handle
// (peran hanya-lihat mendapat 403), bukan sekadar login.
export function POST(request: Request, context: Context) {
  return withApiPermission(request, { alert: ["handle"] }, async (session) => {
    const { id } = await context.params;
    const result = await markAlertHandled(
      id,
      session.user.name || session.user.email,
      session.user.id,
    );
    if (!result.ok) {
      if (result.error === "not_found")
        return NextResponse.json(
          { error: "not_found", message: "Alert tidak ditemukan." },
          { status: 404 },
        );
      return NextResponse.json(
        { error: "not_active", message: "Alert sudah tidak aktif." },
        { status: 409 },
      );
    }
    return NextResponse.json({ data: result.data });
  });
}
