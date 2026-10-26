import "server-only";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq, sql } from "drizzle-orm";
import { admin } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { authCookiePrefix, siteConfig } from "@/config/site";
import { authAdvancedOptions, sessionOptions } from "@/lib/auth-security";
import { env } from "@/lib/env";
import { ac, ADMIN_ROLES, DEFAULT_ROLE, roles } from "@/lib/permissions";

export const auth = betterAuth({
  appName: siteConfig.name,
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  // Sesi 7 hari, diperpanjang paling sering sekali sehari; cookie httpOnly,
  // SameSite=Lax, Path=/; alamat klien untuk batas laju hanya dari proxy yang
  // didaftarkan di TRUSTED_PROXIES. Alasan lengkap ada di lib/auth-security.ts.
  session: sessionOptions,
  advanced: authAdvancedOptions({
    cookiePrefix: authCookiePrefix,
    trustedProxies: env.TRUSTED_PROXIES,
  }),
  emailAndPassword: {
    enabled: true,
    // Tanpa ini siapa pun yang membuka aplikasi bisa membuat akun sendiri.
    disableSignUp: !env.ALLOW_SIGN_UP,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    // Add an email provider before enabling verification or password recovery.
    requireEmailVerification: false,
  },
  plugins: [
    // Roles come from the access control in lib/permissions.ts. New accounts get
    // DEFAULT_ROLE; `role` is not accepted from signup input, so nobody can
    // grant themselves one. Use npm run role:set to promote an account.
    admin({
      ac,
      roles,
      defaultRole: DEFAULT_ROLE,
      adminRoles: ADMIN_ROLES,
    }),
    // Keep nextCookies() last so it observes every other plugin's cookies.
    nextCookies(),
  ],
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          return {
            data: {
              ...user,
              role: user.role || DEFAULT_ROLE,
            },
          };
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const body = typeof ctx.body === "object" && ctx.body !== null ? ctx.body : null;
      const targetUserId = body && "userId" in body && typeof body.userId === "string" ? body.userId : undefined;
      const newRole = body && "role" in body && typeof body.role === "string" ? body.role : undefined;

      if (ctx.path === "/admin/set-role") {
        if (targetUserId && newRole && newRole !== "superadmin") {
          const [target] = await db
            .select({ role: schema.user.role })
            .from(schema.user)
            .where(eq(schema.user.id, targetUserId))
            .limit(1);
          if (target?.role === "superadmin") {
            const [countRow] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(schema.user)
              .where(eq(schema.user.role, "superadmin"));
            if ((countRow?.count ?? 0) <= 1) {
              throw new APIError("BAD_REQUEST", {
                message: "Tidak dapat menurunkan peran Super Admin terakhir.",
              });
            }
          }
        }
      }

      if (ctx.path === "/admin/remove-user") {
        if (targetUserId) {
          const [target] = await db
            .select({ role: schema.user.role })
            .from(schema.user)
            .where(eq(schema.user.id, targetUserId))
            .limit(1);
          if (target?.role === "superadmin") {
            const [countRow] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(schema.user)
              .where(eq(schema.user.role, "superadmin"));
            if ((countRow?.count ?? 0) <= 1) {
              throw new APIError("BAD_REQUEST", {
                message: "Tidak dapat menghapus Super Admin terakhir.",
              });
            }
          }
        }
      }
    }),
  },
});
