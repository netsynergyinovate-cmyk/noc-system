import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { reassignHierarchyParentSchema } from "@/validators/hierarchy-reassign";
import { reassignHierarchyParent } from "@/services/network-hierarchy.service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withApiSession(request, async () => {
    try {
      const body = await request.json().catch(() => null);
      const parsed = reassignHierarchyParentSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: "Data pemindahan induk tidak valid.",
            details: parsed.error.format(),
          },
          { status: 400 },
        );
      }

      const result = await reassignHierarchyParent(parsed.data);

      return NextResponse.json({
        ok: true,
        success: true,
        message: result.message,
      });
    } catch (err) {
      console.error("[POST REASSIGN PARENT ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}
