import { withApiSession } from "@/lib/api";
import {
  getPageTipContent,
  getAllPageTipsContent,
} from "@/services/tutorial-content.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const url = new URL(request.url);
    const pageParam = url.searchParams.get("page");

    if (pageParam) {
      const tip = await getPageTipContent(pageParam);
      if (!tip) {
        return Response.json(
          { error: `Tips untuk halaman \"${pageParam}\" tidak ditemukan` },
          { status: 404 },
        );
      }
      return Response.json({
        data: tip,
      });
    }

    const allTips = await getAllPageTipsContent();
    return Response.json({
      data: allTips,
      total: Object.keys(allTips).length,
    });
  });
}
