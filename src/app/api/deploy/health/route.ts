import {
  getRealSystemHealthChecks,
  getRealDeploySafetyOverview,
} from "@/services/deploy-safety.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Endpoint pemeriksaan kesehatan aplikasi untuk automation deploy & probe sistem.
 * Mengembalikan status detail tiap komponen (database, migrasi, memori, perangkat).
 */
export async function GET() {
  const [checks, overview] = await Promise.all([
    getRealSystemHealthChecks(),
    getRealDeploySafetyOverview(),
  ]);

  const hasCriticalFailure = checks.some(
    (c) => c.requiredForDeploy && c.status === "failing",
  );

  const statusCode = hasCriticalFailure ? 503 : 200;
  const statusLabel = hasCriticalFailure
    ? "failing"
    : overview.failingChecks > 0
      ? "degraded"
      : "healthy";

  return Response.json(
    {
      status: statusLabel,
      statusCode,
      healthScore: overview.healthScorePercent,
      overallStatus: overview.overallStatus,
      totalChecks: overview.totalChecks,
      passedChecks: overview.passedChecks,
      failingChecks: overview.failingChecks,
      checks,
      overview,
      timestamp: new Date().toISOString(),
    },
    {
      status: statusCode,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Content-Type": "application/json",
      },
    },
  );
}
