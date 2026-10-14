import { createHmac, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type APIRequestContext } from "@playwright/test";

const origin = "http://localhost:3101";
const headers = { Origin: origin };
const secret = process.env.REALTIME_TOKEN_SECRET ?? "";

async function signUp(client: APIRequestContext) {
  const data = {
    name: "Realtime Tester",
    email: `realtime-${randomUUID()}@example.com`,
    password: "Realtime-test-password-123!",
  };
  let response = await client.post("/api/auth/sign-up/email", {
    headers,
    data,
  });
  if (response.status() === 429) {
    // The real auth server limits rapid signups. Honor its retry window once.
    const seconds = Number(response.headers()["retry-after"] || 10);
    expect(Number.isFinite(seconds) && seconds >= 0 && seconds <= 10).toBe(
      true,
    );
    await delay((seconds + 0.1) * 1000);
    response = await client.post("/api/auth/sign-up/email", { headers, data });
  }
  expect(response.status()).toBe(200);
  return (await response.json()).user.id as string;
}

test("the ticket endpoint refuses anonymous callers and unsafe requests", async ({
  request,
}) => {
  expect(secret.length).toBeGreaterThanOrEqual(32); // set by npm run test:e2e

  const anonymous = await request.post("/api/realtime/ticket", { headers });
  expect(anonymous.status()).toBe(401);
  const body = await anonymous.json();
  expect(body.error.code).toBe("UNAUTHORIZED");
  expect(JSON.stringify(body)).not.toContain(secret);

  await signUp(request);
  // A signed-in browser tab on another site must not be able to mint a ticket.
  const crossSite = await request.post("/api/realtime/ticket", {
    headers: { Origin: "https://evil.example" },
  });
  expect(crossSite.status()).toBe(403);
  const noOrigin = await request.post("/api/realtime/ticket");
  expect(noOrigin.status()).toBe(403);
  // The ticket is a credential, so it is not available through a plain GET.
  const get = await request.get("/api/realtime/ticket");
  expect(get.status()).toBe(405);
});

test("a signed-in user gets a short-lived ticket the Go backend can verify", async ({
  request,
}) => {
  const userId = await signUp(request);
  const before = Math.floor(Date.now() / 1000);
  const response = await request.post("/api/realtime/ticket", { headers });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");

  const { data } = await response.json();
  expect(data.wsUrl).toBe("ws://localhost:8180/ws");
  expect(data.apiUrl).toBe("http://localhost:8180");

  // Verify independently of the app's own code: format and signature must match
  // what backend/internal/auth expects.
  const [encodedPayload, encodedSignature, ...rest] = data.token.split(".");
  expect(rest).toHaveLength(0);
  const payload = Buffer.from(encodedPayload, "base64url");
  const expected = createHmac("sha256", secret).update(payload).digest();
  expect(Buffer.from(encodedSignature, "base64url").equals(expected)).toBe(
    true,
  );
  expect(data.token).not.toMatch(/[=+/]/); // base64url, no padding
  const claims = JSON.parse(payload.toString());
  expect(claims.sub).toBe(userId);
  expect(claims.exp).toBe(data.expiresAt);
  expect(claims.exp).toBeGreaterThanOrEqual(before + 55);
  expect(claims.exp).toBeLessThanOrEqual(before + 65);
  expect(JSON.stringify(data)).not.toContain(secret);
});

test("each user's ticket names that user and nobody else", async ({
  request,
  playwright,
}) => {
  const first = await signUp(request);
  const other = await playwright.request.newContext({
    baseURL: "http://localhost:3101",
  });
  try {
    const second = await signUp(other);
    const tokenOf = async (client: APIRequestContext) => {
      const response = await client.post("/api/realtime/ticket", { headers });
      const { data } = await response.json();
      return JSON.parse(
        Buffer.from(data.token.split(".")[0], "base64url").toString(),
      ).sub as string;
    };
    expect(await tokenOf(request)).toBe(first);
    expect(await tokenOf(other)).toBe(second);
    expect(first).not.toBe(second);
  } finally {
    await other.dispose();
  }
});

test("a revoked session can no longer get a ticket", async ({ request }) => {
  await signUp(request);
  expect(
    (await request.post("/api/realtime/ticket", { headers })).status(),
  ).toBe(200);

  const signOut = await request.post("/api/auth/sign-out", {
    headers,
    data: {},
  });
  expect(signOut.status()).toBe(200);
  expect(
    (await request.post("/api/realtime/ticket", { headers })).status(),
  ).toBe(401);
});
