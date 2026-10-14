import { withApiSession } from "@/lib/api";
import {
  getMismatchResolutions,
  updateMismatchResolution,
} from "@/services/billing.service";
import { updateMismatchSchema } from "@/validators/billing";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiSession(request, async () => {
    const data = await getMismatchResolutions();
    return Response.json({ ok: true, data });
  });
}

export async function POST(request: Request) {
  return withApiSession(request, async (session) => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: { code: "BAD_REQUEST", message: "Body JSON tidak valid" } },
        { status: 400 },
      );
    }

    const parsed = updateMismatchSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues[0]?.message ?? "Data tidak valid",
            issues: parsed.error.issues,
          },
        },
        { status: 422 },
      );
    }

    const operatorName = session.user.name || session.user.email || "Petugas";
    const data = await updateMismatchResolution(
      parsed.data,
      operatorName,
      session.user.id,
    );

    return Response.json({ ok: true, data });
  });
}

export async function PATCH(request: Request) {
  return POST(request);
}

export async function PUT(request: Request) {
  return POST(request);
}
