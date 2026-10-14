import { withApiSession } from "@/lib/api";
import {
  MOCK_PREFLIGHT_CHECKS,
  type PreflightCheckItem,
} from "@/lib/dashboard/deploy-safety";
import { validateRequiredEnv } from "@/lib/required-env-validator";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    // Evaluasi preflight nyata menggunakan validator kunci env wajib
    const envValidation = validateRequiredEnv(process.env);

    const checks: PreflightCheckItem[] = MOCK_PREFLIGHT_CHECKS.map((item) => {
      if (item.id === "pf-env-vars") {
        const passed = envValidation.valid;
        return {
          ...item,
          passed,
          detail: passed
            ? `Semua ${envValidation.configuredRequired}/${envValidation.totalRequired} variabel lingkungan wajib terverifikasi (${envValidation.mode}).`
            : `Variabel lingkungan wajib belum lengkap: ${envValidation.missingRequired.concat(envValidation.invalidRequired).join(", ")}.`,
        };
      }
      return item;
    });

    const allPassed = checks.every((c) => c.passed || c.severity !== "critical");

    return Response.json({
      data: {
        checks,
        envValidation,
        allCriticalPassed: allPassed,
        evaluatedAt: new Date().toISOString(),
      },
    });
  });
}
