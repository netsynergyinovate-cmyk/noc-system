import { validateRequiredEnv } from "@/lib/required-env-validator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Endpoint validasi kunci variabel lingkungan wajib untuk automation deploy & pre-flight checklist.
 */
export function GET() {
  const result = validateRequiredEnv(process.env);

  return Response.json(
    {
      data: result,
      status: result.valid ? "ok" : "incomplete",
    },
    {
      status: result.valid ? 200 : 422,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Content-Type": "application/json",
      },
    },
  );
}
