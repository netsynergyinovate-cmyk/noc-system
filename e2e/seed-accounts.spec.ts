import { createHmac, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { seedAccounts } from "../scripts/seed-accounts-lib.mjs";

// `npm run seed:accounts` de ujung ke ujung: dua akun yang dibuat skrip itu
// (lewat seedAccounts, fungsi yang sama dengan yang dipakai CLI) benar-benar
// bisa masuk lewat Better Auth di server produksi, membawa peran yang benar,
// dan hak mengubah data hanya ada pada admin. Logika skripnya (idempoten,
// aturan peran, validasi, larangan produksi) diuji di tests/seed-accounts.test.mjs.
//
// Batas laju masuk (3 per 10 detik per jalur, satu keranjang bersama) nyata dan
// tidak dimatikan: permintaan yang kena 429 menunggu jendelanya lalu diulang.

const origin = "http://localhost:3101";
const headers = { Origin: origin };
const ticketSecret = process.env.REALTIME_TOKEN_SECRET ?? "";

const run = randomUUID().slice(0, 8);
const adminEmail = `seed-admin-${run}@example.com`;
const viewerEmail = `seed-viewer-${run}@example.com`;
const unknownEmail = `seed-unknown-${run}@example.com`;
const specs = [
  { kind: "admin", email: adminEmail, name: "Admin Seed Uji" },
  { kind: "viewer", email: viewerEmail, name: "Viewer Seed Uji" },
] as const;

let pool: Pool;
let adminPassword: string;
let viewerPassword: string;
let adminApi: APIRequestContext;
let viewerApi: APIRequestContext;

async function postSignIn(
  request: APIRequestContext,
  data: { email: string; password: string },
): Promise<APIResponse> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await request.post("/api/auth/sign-in/email", {
      headers,
      data,
    });
    if (response.status() !== 429) return response;
    const seconds = Number(response.headers()["retry-after"] || 10);
    expect(Number.isFinite(seconds) && seconds >= 0 && seconds <= 10).toBe(
      true,
    );
    await delay((seconds + 0.2) * 1000);
  }
  throw new Error(
    "Batas laju masuk tidak pulih setelah beberapa kali menunggu.",
  );
}

function decodeTicket(token: string) {
  const [encodedPayload, encodedSignature, ...rest] = token.split(".");
  expect(rest).toHaveLength(0);
  const payload = Buffer.from(encodedPayload, "base64url");
  const expected = createHmac("sha256", ticketSecret).update(payload).digest();
  expect(Buffer.from(encodedSignature, "base64url").equals(expected)).toBe(
    true,
  );
  return JSON.parse(payload.toString()) as {
    sub: string;
    exp: number;
    perms?: string[];
  };
}

async function ticketOf(request: APIRequestContext) {
  const response = await request.post("/api/realtime/ticket", { headers });
  expect(response.status()).toBe(200);
  const { data } = await response.json();
  return decodeTicket(data.token as string);
}

async function sessionOf(request: APIRequestContext) {
  const response = await request.get("/api/auth/get-session");
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    session: { userId: string };
    user: { id: string; email: string; role: string; emailVerified: boolean };
  } | null;
}

async function routerCount() {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM routers");
  return rows[0].n as number;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ playwright }) => {
  // Dua masuk di sini bisa menunggu jendela batas laju yang dipakai berkas lain.
  test.setTimeout(90_000);
  expect(ticketSecret.length).toBeGreaterThanOrEqual(32); // dari npm run test:e2e
  pool = new Pool({
    connectionString: process.env.STARTER_TEST_DATABASE_URL,
    max: 2,
  });
  const [admin, viewer] = await seedAccounts({
    pool,
    accounts: [...specs],
    now: new Date(),
    production: false,
  });
  expect([admin.status, viewer.status]).toEqual(["created", "created"]);
  adminPassword = admin.generatedPassword as string;
  viewerPassword = viewer.generatedPassword as string;
  // Kata sandi acak: panjang dan tidak sama untuk kedua akun.
  for (const password of [adminPassword, viewerPassword]) {
    expect(password.length).toBeGreaterThanOrEqual(24);
    expect(password).toMatch(/^[A-Za-z0-9]+$/);
  }
  expect(adminPassword).not.toBe(viewerPassword);

  adminApi = await playwright.request.newContext({ baseURL: origin });
  viewerApi = await playwright.request.newContext({ baseURL: origin });
  for (const [api, email, password] of [
    [adminApi, adminEmail, adminPassword],
    [viewerApi, viewerEmail, viewerPassword],
  ] as const) {
    const response = await postSignIn(api, { email, password });
    expect(response.status(), await response.text()).toBe(200);
  }
});

test.afterAll(async () => {
  try {
    // Menghapus pengguna ikut menghapus akun dan sesinya (ON DELETE CASCADE).
    await pool?.query('DELETE FROM "user" WHERE email = ANY($1)', [
      [adminEmail, viewerEmail],
    ]);
  } finally {
    await adminApi?.dispose();
    await viewerApi?.dispose();
    await pool?.end();
  }
});

test("both seeded accounts sign in and carry the role the seed gave them", async () => {
  const admin = await sessionOf(adminApi);
  const viewer = await sessionOf(viewerApi);
  expect(admin?.user).toMatchObject({
    email: adminEmail,
    role: "admin",
    emailVerified: true,
  });
  expect(viewer?.user).toMatchObject({
    email: viewerEmail,
    role: "user",
    emailVerified: true,
  });
  expect(admin?.user.id).not.toBe(viewer?.user.id);

  const { rows } = await pool.query(
    `SELECT u.email, u.role, a.provider_id, a.account_id = u.id AS linked
       FROM "user" u JOIN account a ON a.user_id = u.id
      WHERE u.email = ANY($1) ORDER BY u.email`,
    [[adminEmail, viewerEmail]],
  );
  expect(rows).toEqual([
    {
      email: adminEmail,
      role: "admin",
      provider_id: "credential",
      linked: true,
    },
    {
      email: viewerEmail,
      role: "user",
      provider_id: "credential",
      linked: true,
    },
  ]);
});

test("the read-only account is refused on both router endpoints, the admin passes the guard", async () => {
  const before = await routerCount();
  for (const url of ["/api/routers", "/api/routers/test"]) {
    // Isi kosong: izin diperiksa lebih dulu, jadi 403, bukan 422 validasi.
    for (const options of [{ data: {} }, {}]) {
      const denied = await viewerApi.post(url, { headers, ...options });
      expect(denied.status(), url).toBe(403);
      expect((await denied.json()).error.code).toBe("FORBIDDEN");
    }
    // Admin lolos penjagaan lalu berhenti di validasi: tidak ada koneksi keluar.
    const allowed = await adminApi.post(url, { headers, data: {} });
    expect(allowed.status(), url).toBe(422);
    expect((await allowed.json()).error.code).toBe("VALIDATION_ERROR");
  }
  expect(await routerCount()).toBe(before);
});

test("the realtime ticket carries alert:handle for the admin only", async () => {
  const { rows } = await pool.query(
    'SELECT id, email FROM "user" WHERE email = ANY($1)',
    [[adminEmail, viewerEmail]],
  );
  const idOf = (email: string) =>
    rows.find((row) => row.email === email)?.id as string;

  const admin = await ticketOf(adminApi);
  expect(admin.sub).toBe(idOf(adminEmail));
  expect(admin.perms).toEqual(["alert:handle"]);

  const viewer = await ticketOf(viewerApi);
  expect(viewer.sub).toBe(idOf(viewerEmail));
  expect(viewer.perms ?? []).not.toContain("alert:handle");
  expect(Object.keys(viewer).sort()).toEqual(["exp", "sub"]);
});

test("a wrong password stays a plain 401, identical for known and unknown emails", async ({
  playwright,
}) => {
  test.setTimeout(60_000);
  const anonymous = await playwright.request.newContext({ baseURL: origin });
  try {
    const attempts = [
      { email: adminEmail, password: `${adminPassword}x` },
      { email: viewerEmail, password: "salah-sama-sekali-1" },
      { email: unknownEmail, password: "salah-sama-sekali-1" },
    ];
    const answers: Array<{ status: number; body: string }> = [];
    for (const attempt of attempts) {
      const response = await postSignIn(anonymous, attempt);
      expect(response.headers()["set-cookie"]).toBeUndefined();
      answers.push({ status: response.status(), body: await response.text() });
    }
    expect(answers.map((answer) => answer.status)).toEqual([401, 401, 401]);
    expect(answers[0].body).toBe(answers[1].body);
    expect(answers[0].body).toBe(answers[2].body);
    for (const answer of answers) {
      expect(answer.body).not.toContain(adminPassword);
      expect(answer.body).not.toContain(viewerPassword);
    }
    expect((await anonymous.get("/api/auth/get-session")).status()).toBe(200);
    expect(
      await (await anonymous.get("/api/auth/get-session")).json(),
    ).toBeNull();
  } finally {
    await anonymous.dispose();
  }
});

test("running the seed again does not change the passwords that already work", async ({
  playwright,
}) => {
  test.setTimeout(60_000);
  const again = await seedAccounts({
    pool,
    // Kata sandi lain di spesifikasi tidak boleh menimpa yang sudah ada.
    accounts: specs.map((spec) => ({
      ...spec,
      password: "Sandi-Susulan-Tidak-Boleh-Berlaku",
    })),
    now: new Date(),
    production: false,
  });
  expect(again.map((result) => result.status)).toEqual(["exists", "exists"]);
  expect(again.every((result) => result.generatedPassword === undefined)).toBe(
    true,
  );

  const fresh = await playwright.request.newContext({ baseURL: origin });
  try {
    const old = await postSignIn(fresh, {
      email: adminEmail,
      password: adminPassword,
    });
    expect(old.status()).toBe(200);
    const imposed = await postSignIn(fresh, {
      email: adminEmail,
      password: "Sandi-Susulan-Tidak-Boleh-Berlaku",
    });
    expect(imposed.status()).toBe(401);
  } finally {
    await fresh.dispose();
  }
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM "user" WHERE email = ANY($1)',
    [[adminEmail, viewerEmail]],
  );
  expect(rows[0].n).toBe(2);
});

test("resetting a password cuts the old session and the old password, and the new one works", async ({
  playwright,
}) => {
  test.setTimeout(60_000);
  expect((await sessionOf(viewerApi))?.user.email).toBe(viewerEmail);

  const [, viewer] = await seedAccounts({
    pool,
    accounts: [specs[0], { ...specs[1], resetPassword: true }],
    now: new Date(),
    production: false,
  });
  expect(viewer.status).toBe("reset");
  const newPassword = viewer.generatedPassword as string;
  expect(newPassword).toBeTruthy();
  expect(newPassword).not.toBe(viewerPassword);

  // Sesi lama mati seketika (sesi tidak di-cache di cookie).
  expect(await sessionOf(viewerApi)).toBeNull();
  // Sesi admin tidak ikut tercabut.
  expect((await sessionOf(adminApi))?.user.email).toBe(adminEmail);

  const fresh = await playwright.request.newContext({ baseURL: origin });
  try {
    expect(
      (
        await postSignIn(fresh, {
          email: viewerEmail,
          password: viewerPassword,
        })
      ).status(),
    ).toBe(401);
    const response = await postSignIn(fresh, {
      email: viewerEmail,
      password: newPassword,
    });
    expect(response.status(), await response.text()).toBe(200);
    const session = await sessionOf(fresh);
    expect(session?.user).toMatchObject({ email: viewerEmail, role: "user" });
    // Masih hanya-lihat sesudah reset.
    const denied = await fresh.post("/api/routers", { headers, data: {} });
    expect(denied.status()).toBe(403);
  } finally {
    await fresh.dispose();
  }
});
