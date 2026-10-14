import { z } from "zod";
import { readJson, withApiPermission } from "@/lib/api";
import { runAutomaticSchemaMigrationsWithRetry } from "@/services/schema-migration-runner.service";

export const runtime = "nodejs";

const runMigrationSchema = z
  .object({
    dryRun: z.boolean().optional().default(false),
    timescale: z.boolean().optional().default(false),
  })
  .strict();

export function POST(request: Request) {
  return withApiPermission(request, { router: ["manage"] }, async () => {
    const raw = await readJson(request).catch(() => ({}));
    const body = runMigrationSchema.parse(raw);

    const result = await runAutomaticSchemaMigrationsWithRetry(undefined, {
      dryRun: body.dryRun,
      timescale: body.timescale,
    });

    return Response.json({ data: result });
  });
}
