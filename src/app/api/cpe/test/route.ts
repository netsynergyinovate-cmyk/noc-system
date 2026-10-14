import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { buildGenieacsTestConfig, runGenieacsTest, toStandardTestResult } from "@/lib/genieacs/test-connection";
import { testGenieacsSchema } from "@/validators/cpe";

export const runtime = "nodejs";

// Body opsional: tanpa body, uji konfigurasi env (GENIEACS_NBI_*).
export function POST(request: Request) {
  return withApiPermission(request, { cpe: ["manage"] }, async () => {
    const hasBody = request.headers.has("content-type");
    const input = testGenieacsSchema.parse(hasBody ? await readJson(request) : {});

    let config;
    try {
      config = buildGenieacsTestConfig(input);
    } catch {
      throw new ApiError(422, "INVALID_HOST", "Host GenieACS tidak valid (harus http/https).");
    }
    const standard = toStandardTestResult(config, await runGenieacsTest(config));
    // Field lama (ok, latencyMs, error, deviceCount, mode) tetap di level atas.
    return Response.json({ ...standard, success: true, data: standard });
  });
}
