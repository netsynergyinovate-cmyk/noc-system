import { ApiError, withApiSession } from "@/lib/api";
import { MapDataAdapter } from "@/services/map/adapter";
import { ClassifiedCentralApiError } from "@/services/map/types";
import { z } from "zod";

export const runtime = "nodejs";

const idSchema = z.string().min(1, "ID perangkat wajib diisi");
const rangeSchema = z.enum(["live", "1h", "6h", "24h", "7d"]).catch("live");

export function GET(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async () => {
    const id = idSchema.parse((await props.params).id);
    const range = rangeSchema.parse(
      new URL(request.url).searchParams.get("range") ?? "live",
    );
    try {
      const { detail, choices } = await MapDataAdapter.getOltDetail(id, range);
      return Response.json(
        { data: detail, choices },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (err: unknown) {
      if (err instanceof ClassifiedCentralApiError) {
        throw new ApiError(err.status, err.code, err.message);
      }
      throw err;
    }
  });
}
