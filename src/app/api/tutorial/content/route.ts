import { withApiSession } from "@/lib/api";
import {
  getPageTipContent,
  getAllPageTipsContent,
  savePageTipContent,
} from "@/services/tutorial-content.service";
import type { PageTipItem } from "@/lib/dashboard/page-tips-data";

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

export function POST(request: Request) {
  return withApiSession(request, async () => {
    let body: Partial<PageTipItem> = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json(
        { error: "Payload JSON tidak valid" },
        { status: 400 },
      );
    }

    if (!body.pagePath || !body.pageTitle || !body.summary) {
      return Response.json(
        { error: "pagePath, pageTitle, dan summary wajib diisi" },
        { status: 422 },
      );
    }

    const tip: PageTipItem = {
      pagePath: body.pagePath,
      pageTitle: body.pageTitle,
      summary: body.summary,
      metrics: body.metrics ?? [],
      troubleshooting: body.troubleshooting ?? [],
    };

    const saved = await savePageTipContent(tip);

    return Response.json(
      {
        data: saved,
        message: `Tips halaman \"${saved.pagePath}\" berhasil disimpan ke database.`,
      },
      { status: 201 },
    );
  });
}
