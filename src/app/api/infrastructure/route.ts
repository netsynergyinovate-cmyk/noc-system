import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import {
  createInfrastructurePointSchema,
  infrastructureQuerySchema,
  updateInfrastructureLocationSchema,
  deleteInfrastructurePointSchema,
} from "@/validators/infrastructure-placement";
import {
  createInfrastructurePoint,
  getInfrastructureList,
  updateInfrastructureLocation,
  deleteInfrastructurePoint,
} from "@/services/map-infrastructure.service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const url = new URL(request.url);
      const rawParams = {
        type: url.searchParams.get("type") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        search: url.searchParams.get("search") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
        offset: url.searchParams.get("offset") ?? undefined,
        forceMock:
          url.searchParams.get("forceMock") ??
          (url.searchParams.get("mode") === "mock" ? "true" : undefined),
      };

      const parsed = infrastructureQuerySchema.safeParse(rawParams);
      const result = await getInfrastructureList(
        parsed.success ? parsed.data : undefined,
      );

      return NextResponse.json({
        ok: true,
        success: true,
        data: result.infrastructure,
        summary: result.summary,
        dataSource: result.dataSource,
      });
    } catch (err) {
      console.error("[GET INFRASTRUCTURE ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  return withApiSession(request, async (session) => {
    try {
      const body = await request.json().catch(() => null);
      const parsed = createInfrastructurePointSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: "Format data titik perangkat infrastruktur tidak valid.",
            details: parsed.error.format(),
          },
          { status: 400 },
        );
      }

      const newPoint = await createInfrastructurePoint(
        parsed.data,
        session.user.id,
      );

      return NextResponse.json({
        ok: true,
        success: true,
        data: newPoint,
        message: `Titik perangkat '${newPoint.name}' (${newPoint.type.toUpperCase()}) berhasil ditambahkan.`,
      });
    } catch (err) {
      console.error("[POST INFRASTRUCTURE ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}

export async function PATCH(request: Request) {
  return withApiSession(request, async (session) => {
    try {
      const url = new URL(request.url);
      const body = await request.json().catch(() => null);
      const parsed = updateInfrastructureLocationSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            ok: false,
            error: "Koordinat perpindahan perangkat tidak valid.",
            details: parsed.error.format(),
          },
          { status: 400 },
        );
      }

      const id = parsed.data.id || url.searchParams.get("id");

      if (!id) {
        return NextResponse.json(
          { ok: false, error: "ID perangkat infrastruktur wajib ditentukan." },
          { status: 400 },
        );
      }

      const updated = await updateInfrastructureLocation(
        id,
        parsed.data,
        session.user.id,
      );

      return NextResponse.json({
        ok: true,
        success: true,
        data: updated,
        message: "Posisi perangkat infrastruktur berhasil diperbarui.",
      });
    } catch (err) {
      console.error("[PATCH INFRASTRUCTURE POSITION ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}

export const PUT = PATCH;

export async function DELETE(request: Request) {
  return withApiSession(request, async (session) => {
    try {
      const url = new URL(request.url);
      let id = url.searchParams.get("id");

      if (!id) {
        const body = await request.json().catch(() => null);
        const parsed = deleteInfrastructurePointSchema.safeParse(body);
        if (parsed.success) {
          id = parsed.data.id;
        }
      }

      if (!id) {
        return NextResponse.json(
          { ok: false, error: "ID perangkat yang akan dihapus wajib ditentukan." },
          { status: 400 },
        );
      }

      const result = await deleteInfrastructurePoint(id, session.user.id);

      return NextResponse.json({
        ok: true,
        success: true,
        data: result,
        message: "Perangkat infrastruktur berhasil dihapus dari peta.",
      });
    } catch (err) {
      console.error("[DELETE INFRASTRUCTURE ERROR]", err);
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  });
}

