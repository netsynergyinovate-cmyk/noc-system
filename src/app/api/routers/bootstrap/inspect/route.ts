import { NextResponse } from "next/server";
import { withApiPermission, readJson, ApiError } from "@/lib/api";
import { inspectRouter } from "@/services/router-provision.service";
import { connectionSchema, failure, toConn } from "../_shared";

export const runtime = "nodejs";

// Membuat SERVER menghubungi host dari pemanggil: hanya router:manage. Kredensial admin tidak disimpan/dicatat.
export const POST = (request: Request) =>
  withApiPermission(request, { router: ["manage"] }, async () => {
    const parsed = connectionSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "Check the supplied fields.");
    const conn = toConn(parsed.data);
    try {
      return NextResponse.json({ success: true, data: { ok: true, ...(await inspectRouter(conn)) } });
    } catch (err) {
      const f = await failure(err, parsed.data, conn);
      if (f) return NextResponse.json({ success: true, data: f });
      throw err;
    }
  });
