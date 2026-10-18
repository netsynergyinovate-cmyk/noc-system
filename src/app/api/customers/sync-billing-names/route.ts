import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { syncCustomerNamesFromBilling } from "@/services/runsnet-billing.service";

export const runtime = "nodejs";

export function POST(request: Request) {
  return withApiSession(request, async () => {
    try {
      let pullFresh = false;
      try {
        const body = await request.json();
        if (body && typeof body.pullFresh === "boolean") {
          pullFresh = body.pullFresh;
        }
      } catch {
        // Request body kosong atau bukan JSON valid, gunakan default pullFresh=false
      }

      const result = await syncCustomerNamesFromBilling({ pullFresh });
      return NextResponse.json({
        ok: true,
        data: result,
        message: result.message,
      });
    } catch (err) {
      console.error("[SYNC BILLING CUSTOMER NAMES ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, error: msg },
        { status: 500 }
      );
    }
  });
}

export function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const result = await syncCustomerNamesFromBilling({ pullFresh: false });
      return NextResponse.json({
        ok: true,
        data: result,
      });
    } catch (err) {
      console.error("[GET SYNC BILLING NAMES STATS ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, error: msg },
        { status: 500 }
      );
    }
  });
}

