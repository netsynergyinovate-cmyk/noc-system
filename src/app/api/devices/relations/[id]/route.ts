import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import { updateDeviceRelationSchema } from "@/validators/device-relations";
import {
  deleteDeviceRelation,
  updateDeviceRelation,
} from "@/services/device-relations.service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  return withApiSession(request, async () => {
    try {
      const { id } = await params;
      if (!id) {
        return NextResponse.json(
          { error: "ID relasi wajib disertakan." },
          { status: 400 },
        );
      }

      const body = await request.json();
      const parsed = updateDeviceRelationSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Data pembaruan relasi tidak valid.",
            details: parsed.error.format(),
          },
          { status: 400 },
        );
      }

      const result = await updateDeviceRelation(id, parsed.data);

      if (!result.success) {
        return NextResponse.json({ error: result.message }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        message: result.message,
        data: result.data,
      });
    } catch (error) {
      console.error("[PATCH_DEVICE_RELATION_ERROR]", error);
      return NextResponse.json(
        {
          error: "Gagal memperbarui relasi perangkat.",
          message:
            error instanceof Error ? error.message : "Internal Server Error",
        },
        { status: 500 },
      );
    }
  });
}

export async function DELETE(request: Request, { params }: RouteParams) {
  return withApiSession(request, async () => {
    try {
      const { id } = await params;
      if (!id) {
        return NextResponse.json(
          { error: "ID relasi wajib disertakan." },
          { status: 400 },
        );
      }

      const result = await deleteDeviceRelation(id);

      if (!result.success) {
        return NextResponse.json({ error: result.message }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        message: result.message,
      });
    } catch (error) {
      console.error("[DELETE_DEVICE_RELATION_ERROR]", error);
      return NextResponse.json(
        {
          error: "Gagal menghapus relasi perangkat.",
          message:
            error instanceof Error ? error.message : "Internal Server Error",
        },
        { status: 500 },
      );
    }
  });
}
