import { getRawPool } from "@/db";
import {
  MOCK_ONBOARDING_STEPS,
  type OnboardingStep,
  type OnboardingOverview,
  computeStepStatuses,
  getMockOnboardingOverview,
} from "@/lib/dashboard/onboarding-data";

export interface OnboardingStepsResponseData {
  steps: OnboardingStep[];
  overview: OnboardingOverview;
  completedStepIds: string[];
  gateCleared: boolean;
  retrievedAt: string;
}

/**
 * Memastikan langkah tutorial bawaan terdaftar di tabel `onboarding_steps`.
 */
export async function ensureDefaultOnboardingStepsSeeded(): Promise<void> {
  try {
    const pool = getRawPool();
    const client = await pool.connect();
    try {
      const res = await client.query("SELECT COUNT(*) AS count FROM \"onboarding_steps\"");
      const count = Number(res.rows[0]?.count ?? 0);
      if (count === 0) {
        for (const step of MOCK_ONBOARDING_STEPS) {
          await client.query(
            `INSERT INTO "onboarding_steps"
             ("id", "step_number", "type", "title", "description", "target_url", "target_label", "prerequisite_step_ids", "estimated_minutes")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT ("id") DO NOTHING`,
            [
              step.id,
              step.order,
              step.type,
              step.title,
              step.description,
              step.targetUrl,
              step.targetLabel,
              [...step.prerequisites],
              step.estimatedMinutes,
            ],
          );
        }
      }
    } finally {
      client.release();
    }
  } catch {
    // Abaikan jika database belum siap
  }
}

/**
 * Mengambil daftar langkah tutorial beserta status prasyarat & progres operator.
 */
export async function getOnboardingStepsWithPrerequisites(
  userId?: string,
): Promise<OnboardingStepsResponseData> {
  const completedStepIds = new Set<string>();

  try {
    const pool = getRawPool();
    const client = await pool.connect();
    try {
      await ensureDefaultOnboardingStepsSeeded();

      if (userId) {
        const progRes = await client.query(
          `SELECT "step_id", "status" FROM "onboarding_progress" WHERE "user_id" = $1`,
          [userId],
        );
        for (const row of progRes.rows) {
          if (row.status === "selesai") {
            completedStepIds.add(row.step_id);
          }
        }
      }
    } finally {
      client.release();
    }
  } catch {
    // Fallback default jika database belum terhubung
    for (const step of MOCK_ONBOARDING_STEPS) {
      if (step.status === "selesai") {
        completedStepIds.add(step.id);
      }
    }
  }

  // Hitung ulang status langkah dengan prasyarat
  const steps = computeStepStatuses(MOCK_ONBOARDING_STEPS, completedStepIds);
  const overview = getMockOnboardingOverview(steps);

  return {
    steps,
    overview,
    completedStepIds: Array.from(completedStepIds),
    gateCleared: overview.isGatePassed,
    retrievedAt: new Date().toISOString(),
  };
}
