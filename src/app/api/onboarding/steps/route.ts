import { withApiSession } from "@/lib/api";
import { getOnboardingStepsWithPrerequisites } from "@/services/onboarding.service";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async (session) => {
    const data = await getOnboardingStepsWithPrerequisites(session?.user?.id);

    return Response.json({
      data,
    });
  });
}
