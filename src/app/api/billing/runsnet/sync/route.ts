import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { runRunsnetSync } from "@/services/runsnet-billing.service";

export const runtime = "nodejs";

export function POST(request: Request) {
  return withApiSession(request, async () => {
    try {
      const summary = await runRunsnetSync();
      return NextResponse.json({
        ok: true,
        data: summary,
        message: `Berhasil menyinkronkan ${summary.customersCount} pelanggan, ${summary.invoicesCount} invoice, dan ${summary.paymentsCount} riwayat pembayaran dari RunsNet ke database. IP/MAC terbaca ${summary.sessionRead} dari ${summary.sessionTotal} pelanggan.`,
      });
    } catch (err) {
      console.error("[RUNSNET SYNC ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, error: msg },
        { status: 500 }
      );
    }
  });
}

