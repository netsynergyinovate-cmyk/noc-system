import { ApiError, withApiPermission } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { revokeApiKeyAny } from "@/services/api-keys.service";
import { apiKeyIdSchema } from "@/validators/api-keys";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

// Mencabut kunci (baris tetap ada untuk jejak). Permintaan berikutnya dengan
// kunci itu langsung 401.
export function DELETE(request: Request, context: Context) {
  const audit = withAudit({ action: "api-key-revoked" });
  return withApiPermission(
    request,
    { apiKey: ["manage"] },
    audit(request, async (session) => {
      if (session.apiKeyId)
        throw new ApiError(
          403,
          "SESSION_REQUIRED",
          "Manage API keys from a signed-in session.",
        );
      const id = apiKeyIdSchema.parse((await context.params).id);
      if (!(await revokeApiKeyAny(id)))
        throw new ApiError(
          404,
          "NOT_FOUND",
          "API key not found or already revoked.",
        );
      return new Response(null, { status: 204 });
    }),
  );
}
