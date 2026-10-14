import { NextResponse } from "next/server";
import { readJson, withApiSession } from "@/lib/api";
import { recordAudit } from "@/services/audit.service";
import { sendWhatsappRequest } from "@/services/whatsapp.service";
import { sendWhatsappSchema } from "@/validators/whatsapp";

export const runtime = "nodejs";

const bad = (message: string) =>
  NextResponse.json({ error: "validation_error", message }, { status: 400 });

export function POST(request: Request) {
  return withApiSession(request, async (session) => {
    const parsed = sendWhatsappSchema.safeParse(await readJson(request));
    if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Input tidak valid.");
    const input = parsed.data;

    const result = await sendWhatsappRequest(input);
    if (result.kind === "invalid") return bad(result.message);

    if (result.kind === "broadcast") {
      await recordAudit({
        userId: session.user.id,
        action: "whatsapp_send",
        target: "broadcast",
        detail: {
          alertKind: input.alertKind ?? null,
          totalSent: result.totalSent,
          totalFailed: result.totalFailed,
        },
      });
      return NextResponse.json({
        ok: true,
        data: {
          broadcast: true,
          totalSent: result.totalSent,
          totalFailed: result.totalFailed,
          logs: result.logs,
        },
      });
    }

    await recordAudit({
      userId: session.user.id,
      action: "whatsapp_send",
      target: result.target,
      detail: {
        logId: result.logId,
        alertKind: input.alertKind ?? null,
        ok: result.ok,
        error: result.error ?? null,
      },
    });
    return NextResponse.json({
      ok: result.ok,
      data: {
        logId: result.logId,
        target: result.target,
        message: input.message,
        error: result.error,
      },
    });
  });
}
