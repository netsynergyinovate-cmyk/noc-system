import { withApiSession } from "@/lib/api";
import {
  getAppConfigValidation,
  getRedactedAppConfig,
} from "@/services/config-loader.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () =>
    Response.json({
      success: true,
      data: {
        config: getRedactedAppConfig(),
        validation: getAppConfigValidation(),
      },
    }),
  );
}
