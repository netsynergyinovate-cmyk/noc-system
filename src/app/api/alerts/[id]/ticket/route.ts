import { NextResponse } from "next/server";
import { readJson, withApiSession } from "@/lib/api";
import { goDiagnostics } from "@/lib/diagnostics/go-backend";
import { getAlertTicket, updateAlertTicket } from "@/services/alerts.service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export function GET(request: Request, context: Context) {
  return withApiSession(request, async () => {
    const { id } = await context.params;
    const data = await getAlertTicket(id);
    if (!data)
      return NextResponse.json(
        { error: "not_found", message: "Alert tidak ditemukan." },
        { status: 404 },
      );
    return NextResponse.json({ data });
  });
}

export function POST(request: Request, context: Context) {
  return withApiSession(request, async (session) => {
    const { id } = await context.params;
    const raw = await readJson(request);
    const body =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const result = await updateAlertTicket(
      id,
      body,
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
        { error: "validation_error", details: result.details },
        { status: 400 },
      );
    }
    // Keluhan masuk = diagnosa otomatis DI GO (sesudah tiket tersimpan; gagal di
    // sini tidak membatalkan tiket, tetapi dicatat).
    void goDiagnostics(
      session.user.id,
      "/api/v1/diagnostics/auto",
      { method: "POST", body: JSON.stringify({ alertId: id, reason: "ticket" }) },
    ).catch((err) =>
      console.error("Pemicu diagnosa dari tiket gagal:", err instanceof Error ? err.message : err),
    );
    return NextResponse.json({ ok: true, data: result.data });
  });
}
