import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { authCookiePrefix } from "@/config/site";
import { db } from "@/db";
import { user as userTable } from "@/db/schema";
import type { Permissions } from "@/lib/permissions";
import { roleCan } from "@/lib/roles";
import { sessionRejectedUrl } from "@/lib/session-redirect";

export interface SessionData {
  user: {
    id: string;
    name: string;
    email: string;
    role: string | null;
  };
  session: {
    id: string;
    token: string;
    userId: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
}

function verifyToken(token: string): { user_id: string; sub: string; role: string; exp: number } | null {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    return null;
  }
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;

    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    if (header.alg !== "HS256") {
      return null;
    }

    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(sigB64), Buffer.from(expectedSig))) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (typeof payload.exp !== "number" || Date.now() / 1000 > payload.exp) {
      return null;
    }
    if (!payload.user_id) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export const getSession = cache(async (): Promise<SessionData | null> => {
  const headerList = await headers();
  let token: string | null = null;
  const authHeader = headerList.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  }
  if (!token) {
    const cookieHeader = headerList.get("cookie") || "";
    const match = cookieHeader.match(/(?:^|;\s*)noc_token=([^;]+)/);
    if (match) token = decodeURIComponent(match[1]);
  }
  if (!token) return null;

  const claims = verifyToken(token);
  if (!claims) return null;

  try {
    const [row] = await db
      .select({
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        role: userTable.role,
        banned: userTable.banned,
        banExpires: userTable.banExpires,
      })
      .from(userTable)
      .where(eq(userTable.id, claims.user_id))
      .limit(1);

    if (!row) {
      return null;
    }

    if (row.banned) {
      if (!row.banExpires || new Date() < row.banExpires) {
        return null;
      }
    }

    return {
      user: {
        id: row.id,
        name: row.name || claims.sub || "User",
        email: row.email,
        role: row.role || "user",
      },
      session: {
        id: `jwt:${row.id}`,
        token,
        userId: row.id,
        expiresAt: new Date(claims.exp * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
  } catch {
    return null;
  }
});

// Use at the data boundary too: a layout alone doesn't protect actions or APIs.
export async function requireSession(): Promise<SessionData> {
  const session = await getSession();
  if (!session) {
    redirect(sessionRejectedUrl(await headers(), authCookiePrefix));
  }
  return session;
}

// Reads the stored role, so a revoked role takes effect on the next request
// instead of when the session expires.
export async function hasPermission(userId: string, permissions: Permissions): Promise<boolean> {
  try {
    const [row] = await db
      .select({ role: userTable.role })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    if (row && typeof row.role === "string") {
      return roleCan(row.role, permissions);
    }
  } catch {
    // fallback
  }

  return false;
}

// Page and Server Action guard. Renders not-found rather than a "forbidden"
// screen so a signed-in user cannot map out the routes they lack access to.
export async function requirePermission(permissions: Permissions): Promise<SessionData> {
  const session = await requireSession();
  if (!(await hasPermission(session.user.id, permissions))) notFound();
  return session;
}
