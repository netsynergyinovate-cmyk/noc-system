import { withApiPermission } from "@/lib/api";
import { db } from "@/db";
import { cpeTasks } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export const runtime = "nodejs";

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiPermission(request, { cpe: ["manage"] }, async () => {
    const { id } = await params;

    // Ambil hasil list_hosts terakhir yang sukses
    const [latestTask] = await db
      .select({ payload: cpeTasks.payload })
      .from(cpeTasks)
      .where(
        and(
          eq(cpeTasks.customerId, id),
          eq(cpeTasks.action, "list_hosts"),
          eq(cpeTasks.status, "success")
        )
      )
      .orderBy(desc(cpeTasks.createdAt))
      .limit(1);

    const hosts = latestTask?.payload?.hosts || [];

    // Jika belum ada data dari GenieACS, kita juga bisa memasukkan task list_hosts
    // ke antrean di sini agar agen GenieACS mengambil data terbaru.
    // Tapi karena ini endpoint GET (sering dipanggil), sebaiknya kita kembalikan
    // data yang ada saja dan biarkan antrean dikelola terpisah atau cukup return cache.

    return Response.json({ data: hosts });
  });
}
