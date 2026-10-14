import { withApiPermission } from "@/lib/api";
import { executeOnboardingMikrotikTest } from "@/services/onboarding-mikrotik.service";
import type { OnboardingMikrotikInput } from "@/lib/dashboard/onboarding-mikrotik";

export const runtime = "nodejs";

// Server menghubungi host yang disebut pemanggil: butuh router:manage (seperti /api/routers/test).
export function POST(request: Request) {
  return withApiPermission(request, { router: ["manage"] }, async () => {
    let body: Partial<OnboardingMikrotikInput> = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json(
        { error: "Payload JSON tidak valid" },
        { status: 400 },
      );
    }

    const input: OnboardingMikrotikInput = {
      name: body.name ?? "Router Core Utama",
      host: body.host ?? "",
      port: body.port ?? 443,
      username: body.username ?? "",
      password: body.password ?? "",
      useTls: body.useTls ?? true,
      mode: body.mode === "simulator" ? "simulator" : "real",
    };

    const testResult = await executeOnboardingMikrotikTest(input);

    return Response.json({
      data: testResult,
    });
  });
}
