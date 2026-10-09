import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { authCookiePrefix } from "@/config/site";
import { auth } from "@/lib/auth";
import type { Permissions } from "@/lib/permissions";
import { sessionRejectedUrl } from "@/lib/session-redirect";

export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

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
  const { success } = await auth.api.userHasPermission({
    body: { userId, permissions },
  });
  return success;
}

// Page and Server Action guard. Renders not-found rather than a "forbidden"
// screen so a signed-in user cannot map out the routes they lack access to.
export async function requirePermission(permissions: Permissions) {
  const session = await requireSession();
  if (!(await hasPermission(session.user.id, permissions))) notFound();
  return session;
}
