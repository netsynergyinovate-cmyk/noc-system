import { withApiPermission } from "@/lib/api";
import {
  applyUpgradeMigrationsIfNeeded,
  getAppVersionUpgradeHistory,
  getCurrentAppVersion,
  getLatestRecordedAppVersion,
} from "@/services/schema-migration-runner.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiPermission(request, { router: ["manage"] }, async () => {
    const currentVersion = getCurrentAppVersion();
    const recordedVersion = await getLatestRecordedAppVersion();
    const history = await getAppVersionUpgradeHistory();

    return Response.json({
      data: {
        currentVersion,
        recordedVersion,
        isUpgradePending:
          recordedVersion !== null && recordedVersion !== currentVersion,
        history,
      },
    });
  });
}

export function POST(request: Request) {
  return withApiPermission(request, { router: ["manage"] }, async () => {
    const report = await applyUpgradeMigrationsIfNeeded();
    return Response.json({ data: report });
  });
}
