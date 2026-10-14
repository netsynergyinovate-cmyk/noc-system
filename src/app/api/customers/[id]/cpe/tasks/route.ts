import { withApiPermission } from "@/lib/api";
import { db } from "@/db";
import { cpeTasks } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export const runtime = "nodejs";

export function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withApiPermission(request, { cpe: ["manage"] }, async () => {
    const { id } = await params;

    const tasks = await db
      .select({
        id: cpeTasks.id,
        action: cpeTasks.action,
        status: cpeTasks.status,
        createdAt: cpeTasks.createdAt,
        updatedAt: cpeTasks.updatedAt,
      })
      .from(cpeTasks)
      .where(eq(cpeTasks.customerId, id))
      .orderBy(desc(cpeTasks.createdAt))
      .limit(10);

    return Response.json({ data: tasks });
  });
}
