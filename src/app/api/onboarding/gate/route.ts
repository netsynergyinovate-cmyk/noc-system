import { withApiSession } from "@/lib/api";
import {
  enforceOnboardingGate,
  isPathExempt,
  EXEMPT_PATH_PREFIXES,
} from "@/lib/onboarding-gate-middleware";
import { evaluateOnboardingGate } from "@/lib/dashboard/onboarding-gate";
import { hasConnectedDevice } from "@/services/devices.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const hasConnected = await hasConnectedDevice();
    const isLive =
      process.env.DASHBOARD_DATA === "live" ||
      process.env.DATA_MODE === "live" ||
      process.env.DATA_MODE === "nyata";

    const gateState = evaluateOnboardingGate({
      hasConnectedRouter: hasConnected,
      isLiveMode: isLive,
    });

    return Response.json({
      data: {
        gateState,
        hasConnectedRouter: hasConnected,
        isLiveMode: isLive,
        exemptPrefixes: EXEMPT_PATH_PREFIXES,
        evaluatedAt: new Date().toISOString(),
      },
    });
  });
}

export function POST(request: Request) {
  return withApiSession(request, async () => {
    let body: { path?: string; forceLocked?: boolean } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      // Body kosong
    }

    const testPath = body.path ?? "/api/alerts";
    const dummyReq = new Request(`http://localhost:3000${testPath}`);

    const blockedRes = enforceOnboardingGate(dummyReq, {
      forceLocked: body.forceLocked ?? true,
    });

    const isBlocked = Boolean(blockedRes);
    const statusCode = blockedRes ? blockedRes.status : 200;

    return Response.json({
      data: {
        testPath,
        isExempt: isPathExempt(testPath),
        isBlocked,
        statusCode,
        evaluatedAt: new Date().toISOString(),
      },
    });
  });
}
