import { ApiError, withApiSession } from "@/lib/api";
import { MapDataAdapter } from "@/services/map/adapter";
import { ClassifiedCentralApiError } from "@/services/map/types";
import { z } from "zod";

export const runtime = "nodejs";

const idSchema = z.string().min(1, "ID pelanggan wajib diisi");

export function GET(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  return withApiSession(request, async () => {
    const id = idSchema.parse((await props.params).id);
    try {
      const data = await MapDataAdapter.getCustomerDetail(id);
      return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
    } catch (err: unknown) {
      if (err instanceof ClassifiedCentralApiError) {
        throw new ApiError(err.status, err.code, err.message);
      }
      throw err;
    }
  });
}
