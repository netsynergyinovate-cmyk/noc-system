import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { olts } from "@/db/schema";
import { ApiError, withApiPermission } from "@/lib/api";
import { parseTarget } from "@/services/device-connection-tester";
import { HSGQ_TELNET_DRIVER } from "@/lib/olt/hsgq-telnet";
import { pingTcp } from "@/lib/olt/tcp-ping";
import { oltIdSchema } from "@/validators/devices";

export const runtime = "nodejs";

export const POST = (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) =>
  withApiPermission(request, { router: ["manage"] }, async () => {
    const { id } = await params;
    if (!oltIdSchema.safeParse(id).success) {
      throw new ApiError(404, "OLT_NOT_FOUND", "OLT tidak ditemukan.");
    }

    const [olt] = await db
      .select({
        id: olts.id,
        name: olts.name,
        host: olts.host,
        driver: olts.driver,
      })
      .from(olts)
      .where(eq(olts.id, id))
      .limit(1);

    if (!olt) throw new ApiError(404, "OLT_NOT_FOUND", "OLT tidak ditemukan.");

    const parsed = parseTarget(olt.host);
    const host = parsed?.host ?? olt.host;
    const isTelnet = olt.driver === HSGQ_TELNET_DRIVER;
    const port = parsed?.port ?? (isTelnet ? 23 : 80);

    const ping = await pingTcp(host, port, 4000);

    return NextResponse.json({
      data: {
        oltId: olt.id,
        name: olt.name,
        host,
        port,
        ok: ping.ok,
        latencyMs: ping.latencyMs,
        error: ping.error,
      },
    });
  });
