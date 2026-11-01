import "server-only";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq, sql } from "drizzle-orm";
import { admin, genericOAuth } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { authCookiePrefix, siteConfig } from "@/config/site";
import { authAdvancedOptions, sessionOptions } from "@/lib/auth-security";
import { env } from "@/lib/env";
import { ac, ADMIN_ROLES, DEFAULT_ROLE, roles } from "@/lib/permissions";
import { roleNames } from "@/lib/roles";

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
    genericOAuth({
      config: [
        {
          providerId: "logto",
          clientId: env.LOGTO_CLIENT_ID || "logto-client-id",
          clientSecret: env.LOGTO_CLIENT_SECRET || "logto-client-secret",
          scopes: ["openid", "profile", "email"],
          authorizationUrl: `${env.LOGTO_ENDPOINT}/oidc/auth?direct_sign_in=social:google&prompt=login`,
          tokenUrl: `${env.LOGTO_INTERNAL_ENDPOINT || env.LOGTO_ENDPOINT}/oidc/token`,
          userInfoUrl: `${env.LOGTO_INTERNAL_ENDPOINT || env.LOGTO_ENDPOINT}/oidc/me`,
        },
        {
          providerId: "logto-github",
          clientId: env.LOGTO_CLIENT_ID || "logto-client-id",
          clientSecret: env.LOGTO_CLIENT_SECRET || "logto-client-secret",
          scopes: ["openid", "profile", "email"],
          authorizationUrl: `${env.LOGTO_ENDPOINT}/oidc/auth?direct_sign_in=social:github&prompt=login`,
          tokenUrl: `${env.LOGTO_INTERNAL_ENDPOINT || env.LOGTO_ENDPOINT}/oidc/token`,
          userInfoUrl: `${env.LOGTO_INTERNAL_ENDPOINT || env.LOGTO_ENDPOINT}/oidc/me`,
          mapProfileToUser: async (profile) => {
            const rawEmail =
              typeof profile.email === "string" && profile.email
                ? profile.email
                : `${profile.sub ?? profile.id ?? "dev"}+developer@github.local`;
            const at = rawEmail.indexOf("@");
            const devEmail =
              at !== -1
                ? `${rawEmail.slice(0, at)}+developer@${rawEmail.slice(at + 1)}`
                : `${rawEmail}+developer@github.local`;
            const rawName =
              typeof profile.name === "string" && profile.name
                ? profile.name
                : "Developer";
            return {
              email: devEmail,
              emailVerified: false,
              name: rawName.includes("Developer") ? rawName : `${rawName} (Developer)`,
              role: "developer",
            };
          },
        },
      ],
    }),
    admin({
      ac,
      roles,
      defaultRole: DEFAULT_ROLE,
      adminRoles: ADMIN_ROLES,
    }),
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
    account: {
      create: {
        after: async (account) => {
          if (account.providerId === "logto-github") {
            const [target] = await db
              .select({ role: schema.user.role })
              .from(schema.user)
              .where(eq(schema.user.id, account.userId))
              .limit(1);
            if (target && !roleNames(target.role).includes("superadmin") && !roleNames(target.role).includes("admin")) {
              await db
                .update(schema.user)
                .set({ role: "developer" })
                .where(eq(schema.user.id, account.userId));
            }
          } else if (account.providerId === "logto") {
            await db
              .update(schema.user)
              .set({ role: "superadmin" })
              .where(eq(schema.user.id, account.userId));
          }
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const body = typeof ctx.body === "object" && ctx.body !== null ? ctx.body : null;
      const targetUserId = body && "userId" in body && typeof body.userId === "string" ? body.userId : undefined;
      const rawRole = body && "role" in body ? body.role : undefined;
      const parsedRoles = Array.isArray(rawRole)
        ? rawRole.map(String)
        : typeof rawRole === "string"
          ? roleNames(rawRole)
          : [];
      const grantsSuperadmin = parsedRoles.includes("superadmin");

      if (ctx.path === "/admin/set-role" && targetUserId && !grantsSuperadmin) {
        const [target] = await db
          .select({ role: schema.user.role })
          .from(schema.user)
          .where(eq(schema.user.id, targetUserId))
          .limit(1);
        if (roleNames(target?.role).includes("superadmin")) {
          const [countRow] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.user)
            .where(sql`'superadmin' = ANY(string_to_array(coalesce(${schema.user.role}, ''), ','))`);
          if ((countRow?.count ?? 0) <= 1) {
            throw new APIError("BAD_REQUEST", {
              message: "Tidak dapat menurunkan peran Super Admin terakhir.",
            });
          }
        }
      }

      if ((ctx.path === "/admin/remove-user" || ctx.path === "/admin/ban-user") && targetUserId) {
        const [target] = await db
          .select({ role: schema.user.role })
          .from(schema.user)
          .where(eq(schema.user.id, targetUserId))
          .limit(1);
        if (roleNames(target?.role).includes("superadmin")) {
          const [countRow] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(schema.user)
            .where(sql`'superadmin' = ANY(string_to_array(coalesce(${schema.user.role}, ''), ','))`);
          if ((countRow?.count ?? 0) <= 1) {
            throw new APIError("BAD_REQUEST", {
              message: "Tidak dapat menonaktifkan atau menghapus Super Admin terakhir.",
            });
          }
        }
      }
    }),
  },
});
