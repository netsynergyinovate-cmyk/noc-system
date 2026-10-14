import { withApiSession } from "@/lib/api";
import {
  deleteMismatchResolution,
  getMismatchResolution,
  updateMismatchResolution,
} from "@/services/billing.service";
import { updateMismatchSchema } from "@/validators/billing";

export const runtime = "nodejs";

interface RouteProps {
  params: Promise<{ key: string }>;
}

export async function GET(request: Request, { params }: RouteProps) {
  const { key } = await params;
  const decodedKey = decodeURIComponent(key);

  return withApiSession(request, async () => {
    const data = await getMismatchResolution(decodedKey);
    return Response.json({ ok: true, data });
  });
}

export async function PATCH(request: Request, { params }: RouteProps) {
  const { key } = await params;
  const decodedKey = decodeURIComponent(key);

  return withApiSession(request, async (session) => {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json(
        { error: { code: "BAD_REQUEST", message: "Body JSON tidak valid" } },
        { status: 400 },
      );
    }

    const payload = {
      mismatchKey: decodedKey,
      ...body,
    };

    const parsed = updateMismatchSchema.safeParse(payload);
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

export async function PUT(request: Request, props: RouteProps) {
  return PATCH(request, props);
}

export async function DELETE(request: Request, { params }: RouteProps) {
  const { key } = await params;
  const decodedKey = decodeURIComponent(key);

  return withApiSession(request, async (session) => {
    const deleted = await deleteMismatchResolution(decodedKey, session.user.id);
    return Response.json({ ok: true, deleted });
  });
}
