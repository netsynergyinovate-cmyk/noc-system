import starter from "../../starter.config.json";

// Change these values to give every page your app's name and description.
export const siteConfig = {
  id: starter.id,
  name: starter.name,
  description: starter.description,
  homePath: "/app",
} as const;

// Awalan nama cookie sesi Better Auth. Dipakai src/lib/auth.ts (menulis cookie)
// dan src/proxy.ts (membacanya tanpa database); satu konstanta supaya keduanya
// tidak bisa menyimpang.
export const authCookiePrefix = `ngodingpakeai-${starter.id}`;
