import "server-only";
import { ZodError } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user as userTable } from "@/db/schema";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import type { Permissions } from "@/lib/permissions";
import { roleCan } from "@/lib/roles";
import { findApiKeyOwner } from "@/services/api-keys.service";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// `apiKeyId` is set when the caller authenticated with an API key instead of a
// cookie session. Such requests act as the key's owner.
type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>> & {
  apiKeyId?: string;
};

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

// `Authorization: Bearer noc_...` from an external app (see docs/noc/api-key.md).
async function apiKeySession(
  request: Request,
  readsOnly: boolean,
): Promise<Session | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const found = await findApiKeyOwner(header.slice(7).trim());
  if (!found)
    throw new ApiError(
      401,
      "INVALID_API_KEY",
      "API key is invalid or revoked.",
    );
  if (
    found.access === "read" &&
    !readsOnly &&
    !SAFE_METHODS.includes(request.method)
  )
    throw new ApiError(403, "READ_ONLY_API_KEY", "This API key is read-only.");
  const now = new Date();
  return {
    user: found.owner,
    session: {
      id: `api-key:${found.id}`,
      token: "",
      userId: found.owner.id,
      expiresAt: now,
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: request.headers.get("user-agent"),
    },
    apiKeyId: found.id,
  };
}

// Shared HTTP concerns only. Domain rules and Drizzle queries live in services.
// `readsOnly`: the handler changes no data although it is a POST (a computation
// such as /api/snap), so read-only API keys may call it.
export async function withApiSession(
  request: Request,
  handler: (session: Session) => Promise<Response>,
  { readsOnly = false }: { readsOnly?: boolean } = {},
) {
  let response: Response;
  try {
    const session: Session | null =
      (await apiKeySession(request, readsOnly)) ??
      (await auth.api.getSession({
        headers: request.headers,
        query: { disableCookieCache: true },
      }));
    if (!session)
      throw new ApiError(401, "UNAUTHORIZED", "Sign in to continue.");

    if (typeof session.user.role !== "string") {
      try {
        const [row] = await db
          .select({ role: userTable.role })
          .from(userTable)
          .where(eq(userTable.id, session.user.id))
          .limit(1);
        if (row && typeof row.role === "string") {
          session.user.role = row.role;
        }
      } catch {
        // fallback ke role sesi jika query database terkendala
      }
    }

    // Better Auth protects its own endpoints. Custom cookie-authenticated mutations need this check too.
    // An API key is sent explicitly, never by the browser on its own, so it needs no Origin check.
    if (!session.apiKeyId && !SAFE_METHODS.includes(request.method)) {
      if (
        request.headers.get("origin") !== new URL(env.BETTER_AUTH_URL).origin ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        throw new ApiError(
          403,
          "FORBIDDEN_ORIGIN",
          "Send this request from the app's configured origin.",
        );
    }
    response = await handler(session);
  } catch (error) {
    if (error instanceof ApiError) {
      response = Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    } else if (error instanceof ZodError) {
      response = Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Check the supplied fields.",
            details: error.issues.map((issue) => ({
              field: issue.path.join("."),
              message: issue.message,
            })),
          },
        },
        { status: 422 },
      );
    } else {
      // Do not return database errors, connection strings, or private values to clients.
      console.error(
        "Unexpected API failure:",
        error instanceof Error ? error.name : "UnknownError",
      );
      response = Response.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Something went wrong. Try again.",
          },
        },
        { status: 500 },
      );
    }
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

// Same contract as withApiSession, plus a role check before the handler runs.
// Endpoints that reach across accounts must use this, not a UI-only check.
export function withApiPermission(
  request: Request,
  permissions: Permissions,
  handler: (session: Session) => Promise<Response>,
) {
  return withApiSession(request, async (session) => {
    let allowed = false;
    try {
      const { success } = await auth.api.userHasPermission({
        body: { userId: session.user.id, permissions },
      });
      allowed = success;
    } catch {
      // fallback ke evaluasi peran langsung
    }

    if (!allowed && session.user.role) {
      allowed = roleCan(session.user.role, permissions);
    }

    if (!allowed)
      throw new ApiError(
        403,
        "FORBIDDEN",
        "Your account cannot perform this action.",
      );
    return handler(session);
  });
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json")
    throw new ApiError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Send an application/json body.",
    );
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Send valid JSON.");
  }
}
