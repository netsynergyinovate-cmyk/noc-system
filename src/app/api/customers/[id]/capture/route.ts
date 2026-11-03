import { withApiPermission } from "@/lib/api";
import { db } from "@/db";
import { browsingAccessAudit } from "@/db/schema";
import {
  getCustomerCapturesHistory,
  recordCustomerLiveCapture,
} from "@/services/customer-capture.service";

export const runtime = "nodejs";

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiPermission(request, { system: ["manage"] }, async (session) => {
    const { id } = await params;
    try {
      await db.insert(browsingAccessAudit).values({
        userId: session.user.id,
        customerId: id,
        reason: "Melihat riwayat tangkapan inspeksi trafik pelanggan",
      });
    } catch {
      // abaikan
    }
    const history = await getCustomerCapturesHistory(id);
    return Response.json({ data: history });
  });
}

export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiPermission(request, { system: ["manage"] }, async (session) => {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      duration?: unknown;
    };
    if (body.duration !== 15 && body.duration !== 30 && body.duration !== 60) {
      return Response.json(
        { error: { code: "VALIDATION_ERROR", message: "Durasi rekam harus 15, 30, atau 60 detik." } },
        { status: 400 },
      );
    }
    const duration = body.duration as 15 | 30 | 60;

    try {
      await db.insert(browsingAccessAudit).values({
        userId: session.user.id,
        customerId: id,
        reason: `Menjalankan inspeksi tangkapan langsung pelanggan selama ${duration} detik`,
      });
    } catch {
      // abaikan
    }

    try {
      const result = await recordCustomerLiveCapture({
        customerId: id,
        durationSeconds: duration,
        operatorName: session.user.name || "Operator NOC",
        userId: session.user.id,
      });
      return Response.json({ data: result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Perekaman Torch gagal dijalankan.";
      return Response.json({ error: { code: "CAPTURE_ERROR", message: msg } }, { status: 409 });
    }
  });
}
