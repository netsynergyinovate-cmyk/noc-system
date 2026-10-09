import { defineConfig, devices } from "@playwright/test";

const testUrl = process.env.STARTER_TEST_DATABASE_URL;
if (!testUrl || !process.env.STARTER_TEST_RUN?.startsWith("starter-pg-test-")) {
  throw new Error(
    "Use npm run test:e2e so Playwright runs against its own disposable PostgreSQL server.",
  );
}
// Dua server dari build yang sama: yang utama memakai data demo, yang kedua mode
// live untuk menguji gerbang Setup Perangkat. Origin tiap server harus sama
// dengan BETTER_AUTH_URL-nya karena permintaan POST memeriksa Origin.
const baseEnv = {
  NODE_ENV: "production",
  DATABASE_URL: testUrl,
  MIGRATION_DATABASE_URL: testUrl,
  REALTIME_TOKEN_SECRET: process.env.REALTIME_TOKEN_SECRET ?? "",
  BACKEND_URL: process.env.BACKEND_URL ?? "",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:3101", trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium",
      testIgnore: /setup-gate.spec.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "gate",
      testMatch: /setup-gate.spec.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3102" },
    },
  ],
  webServer: [
    {
      command: "npm run start -- --port 3101",
      url: "http://localhost:3101",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...baseEnv,
        BETTER_AUTH_URL: "http://localhost:3101",
        DASHBOARD_DATA: "demo",
      },
      gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    },
    {
      command: "npm run start -- --port 3102",
      url: "http://localhost:3102",
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...baseEnv,
        BETTER_AUTH_URL: "http://localhost:3102",
        DASHBOARD_DATA: "live",
      },
      gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
    },
  ],
});
