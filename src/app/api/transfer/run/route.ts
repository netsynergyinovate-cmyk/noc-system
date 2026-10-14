import { z } from "zod";
import { withApiSession } from "@/lib/api";
import {
  runDataTransferTransactionally,
  TRANSFERRABLE_TABLES,
} from "@/services/data-transfer.service";
import { getTransferConnectionConfig } from "@/lib/transfer-config";

export const runtime = "nodejs";

const transferTriggerSchema = z.object({
  dryRun: z.boolean().optional(),
  conflictStrategy: z
    .enum(["upsert", "skip_existing", "overwrite"])
    .optional(),
  tables: z.array(z.enum(TRANSFERRABLE_TABLES)).optional(),
});

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const config = getTransferConnectionConfig();
    return Response.json({
      data: {
        configured: config.isConfigured,
        source: config.sourceMaskedUrl,
        target: config.targetMaskedUrl,
        batchSize: config.batchSize,
        conflictStrategy: config.conflictStrategy,
        availableTables: TRANSFERRABLE_TABLES,
      },
    });
  });
}

export function POST(request: Request) {
  return withApiSession(request, async (session) => {
    let body = {};
    try {
      body = await request.json();
    } catch {
      // Empty or non-JSON body defaults to empty options
    }

    const parsed = transferTriggerSchema.parse(body);
    const actor = session.user.name || session.user.email || "operator";

    const report = await runDataTransferTransactionally({
      dryRun: parsed.dryRun,
      conflictStrategy: parsed.conflictStrategy,
      tables: parsed.tables,
      actor,
    });

    const status = report.success ? 200 : 400;
    return Response.json({ data: report }, { status });
  });
}
