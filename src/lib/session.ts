import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { authCookiePrefix } from "@/config/site";
import { db } from "@/db";
import { user as userTable } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { Permissions } from "@/lib/permissions";
import { roleCan } from "@/lib/roles";
import { sessionRejectedUrl } from "@/lib/session-redirect";

export const getSession = cache(async () => {
  const session = await auth.api.getSession({
    headers: await headers(),
    query: { disableCookieCache: true },
  });
  if (!session) return null;

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

  return session;
});

// Use at the data boundary too: a layout alone doesn't protect actions or APIs.
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    // Cookie basi atau sesi kedaluwarsa: proxy meloloskannya (ia hanya melihat
    // ada tidaknya cookie), jadi di sini jalur semula ikut dibawa ke halaman
    // masuk, dengan penanda "sesi berakhir" bila cookie-nya ada. Aturannya ada
    // di sessionRejectedUrl supaya bisa diuji tanpa server.
    redirect(sessionRejectedUrl(await headers(), authCookiePrefix));
  }
  return session;
}

// Reads the stored role, so a revoked role takes effect on the next request
// instead of when the session expires.
export async function hasPermission(userId: string, permissions: Permissions) {
  try {
    const { success } = await auth.api.userHasPermission({
      body: { userId, permissions },
    });
    if (success) return true;
  } catch {
    // fallback
  }

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
export async function requirePermission(permissions: Permissions) {
  const session = await requireSession();
  if (!(await hasPermission(session.user.id, permissions))) notFound();
  return session;
}
