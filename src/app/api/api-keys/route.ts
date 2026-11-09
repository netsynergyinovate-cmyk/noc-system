import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { createApiKey, listApiKeysAny } from "@/services/api-keys.service";
import { createApiKeySchema } from "@/validators/api-keys";

export const runtime = "nodejs";

// Kunci hanya dikelola dari sesi login: API key tidak boleh membuat kunci baru.
function requireCookieSession(session: { apiKeyId?: string }) {
  if (session.apiKeyId)
    throw new ApiError(
      403,
      "SESSION_REQUIRED",
      "Manage API keys from a signed-in session.",
    );
}

export function GET(request: Request) {
  return withApiPermission(request, { apiKey: ["manage"] }, async (session) => {
    requireCookieSession(session);
    return Response.json({ data: await listApiKeysAny() });
  });
}

export function POST(request: Request) {
  const audit = withAudit({
    action: "api-key-created",
    getTarget: () => "/api/api-keys",
  });
  return withApiPermission(
    request,
    { apiKey: ["manage"] },
    audit(request, async (session) => {
      requireCookieSession(session);
      const input = createApiKeySchema.parse(await readJson(request));
      const { key, apiKey } = await createApiKey(session.user.id, input);
      return Response.json(
        { data: { ...apiKey, key } },
        { status: 201, headers: { Location: `/api/api-keys/${apiKey.id}` } },
      );
    }),
  );
}
