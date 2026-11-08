import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  firewallRuleHits,
  firewallSnapshots,
} from "@/db/schema";
import { ApiError, withApiSession } from "@/lib/api";
import {
  goDiagnostics,
  shapeRun,
  type GoFinding,
  type GoRun,
} from "@/lib/diagnostics/go-backend";
import { diagnosticRunIdSchema } from "@/validators/diagnostics";

export const runtime = "nodejs";
type Context = { params: Promise<{ runId: string }> };

export function GET(request: Request, context: Context) {
  return withApiSession(request, async (session) => {
    const id = diagnosticRunIdSchema.parse((await context.params).runId);
    try {
      const data = await goDiagnostics<{
        run: GoRun;
        findings: GoFinding[];
      }>(session.user.id, `/api/v1/diagnostics/${id}`);
      const firewallRules = await db
        .select({
          table: firewallRuleHits.table,
          chain: firewallRuleHits.chain,
          ruleIndex: firewallRuleHits.ruleIndex,
          action: firewallRuleHits.action,
          scope: firewallRuleHits.scope,
          summary: firewallRuleHits.summary,
          comment: firewallRuleHits.comment,
          disabled: firewallRuleHits.disabled,
          matchedPackets: firewallRuleHits.matchedPackets,
          isStale: firewallRuleHits.isStale,
        })
        .from(firewallRuleHits)
        .innerJoin(
          firewallSnapshots,
          eq(firewallSnapshots.id, firewallRuleHits.snapshotId),
        )
        .where(eq(firewallSnapshots.runId, id));
      return Response.json({
        data: shapeRun(data.run, data.findings, firewallRules),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new ApiError(404, "NOT_FOUND", "Diagnosa tidak ditemukan.");
      }
      throw err;
    }
  });
}
