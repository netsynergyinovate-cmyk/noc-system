import { NextResponse } from "next/server";
import { readJson, withApiSession } from "@/lib/api";
import { updateAlertTicket, getAlertTicket } from "@/services/alerts.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const url = new URL(request.url);
    const alertId = url.searchParams.get("alertId");
    if (!alertId) {
      return NextResponse.json({ error: "missing_alert_id", message: "Parameter alertId diperlukan." }, { status: 400 });
    }
    const data = await getAlertTicket(alertId);
    if (!data) {
      return NextResponse.json({ error: "not_found", message: "Tiket tidak ditemukan." }, { status: 404 });
    }
    return NextResponse.json({ data });
  });
}

export function POST(request: Request) {
  return withApiSession(request, async (session) => {
    const raw = await readJson(request);
    const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const alertId = typeof body.alertId === "string" ? body.alertId : "";
    if (!alertId) {
      return NextResponse.json({ error: "validation_error", details: ["ID alert wajib diisi."] }, { status: 400 });
    }

    const result = await updateAlertTicket(
      alertId,
      body,
      session.user.name || session.user.email,
      session.user.id,
    );

    if (!result.ok) {
      if (result.error === "not_found") {
        return NextResponse.json({ error: "not_found", message: "Alert tidak ditemukan." }, { status: 404 });
      }
      return NextResponse.json({ error: "validation_error", details: result.details }, { status: 400 });
    }

    return NextResponse.json({ ok: true, data: result.data });
  });
}
