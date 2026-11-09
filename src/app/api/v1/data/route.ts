import { ApiError, withApiSession } from "@/lib/api";
import {
  externalDatasetNames,
  isExternalDataset,
  readExternalDataset,
} from "@/services/external-data.service";
import { readExternalDataSchema } from "@/validators/api-keys";

export const runtime = "nodejs";

// Tarik data mentah per tabel untuk aplikasi luar (API key atau sesi login).
// GET /api/v1/data                         -> daftar dataset
// GET /api/v1/data?dataset=customers&limit=500&offset=0
export function GET(request: Request) {
  return withApiSession(request, async () => {
    const { dataset, limit, offset } = readExternalDataSchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!dataset) return Response.json({ data: externalDatasetNames });
    if (!isExternalDataset(dataset))
      throw new ApiError(
        404,
        "UNKNOWN_DATASET",
        "Unknown dataset. GET /api/v1/data lists them.",
      );
    const { rows, hasMore } = await readExternalDataset(dataset, {
      limit,
      offset,
    });
    return Response.json({
      data: rows,
      meta: {
        dataset,
        limit,
        offset,
        nextOffset: hasMore ? offset + limit : null,
      },
    });
  });
}
