import { NextResponse } from "next/server";
import { withApiSession } from "@/lib/api";
import {
  createDeviceRelationSchema,
  queryDeviceRelationsSchema,
} from "@/validators/device-relations";
import {
  createDeviceRelation,
  getDeviceRelations,
} from "@/services/device-relations.service";

export async function GET(request: Request) {
  return withApiSession(request, async () => {
    try {
      const url = new URL(request.url);
      const queryParams = {
        deviceId: url.searchParams.get("deviceId") || undefined,
        parentId: url.searchParams.get("parentId") || undefined,
        childId: url.searchParams.get("childId") || undefined,
        relationType: url.searchParams.get("relationType") || undefined,
        status: url.searchParams.get("status") || undefined,
      };

      const parsedQuery = queryDeviceRelationsSchema.safeParse(queryParams);
      if (!parsedQuery.success) {
        return NextResponse.json(
          {
            error: "Parameter filter relasi tidak valid.",
            details: parsedQuery.error.format(),
          },
          { status: 400 },
        );
      }

      const relations = await getDeviceRelations(parsedQuery.data);

      return NextResponse.json({
        data: relations,
        total: relations.length,
      });
    } catch (error) {
      console.error("[GET_DEVICE_RELATIONS_ERROR]", error);
      return NextResponse.json(
        {
          error: "Gagal memuat daftar relasi perangkat.",
          message: error instanceof Error ? error.message : "Internal Server Error",
        },
        { status: 500 },
      );
    }
  });
}

export async function POST(request: Request) {
  return withApiSession(request, async () => {
    try {
      const body = await request.json();
      const parsed = createDeviceRelationSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            error: "Data relasi perangkat tidak valid.",
            details: parsed.error.format(),
          },
          { status: 400 },
        );
      }

      const result = await createDeviceRelation(parsed.data);

      if (!result.success) {
        return NextResponse.json(
          {
            error: result.message,
          },
          { status: 422 },
        );
      }

      return NextResponse.json(
        {
          success: true,
          message: result.message,
          data: result.data,
        },
        { status: 201 },
      );
    } catch (error) {
      console.error("[POST_DEVICE_RELATION_ERROR]", error);
      return NextResponse.json(
        {
          error: "Gagal menyimpan relasi perangkat.",
          message: error instanceof Error ? error.message : "Internal Server Error",
        },
        { status: 500 },
      );
    }
  });
}
