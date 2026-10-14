import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import { signUp } from "./billing-ui";

// Otorisasi aksi MENGUBAH data pada server sungguhan (build produksi): hanya
// peran dengan izin yang boleh menambah router, menguji koneksi router, dan
// mendapat tiket realtime yang membawa alert:handle. Akun biasa (hanya-lihat)
// ditolak SEBELUM isi permintaan dibaca dan sebelum server menghubungi host
// mana pun. Logika izinnya ada di e2e/permissions-write.spec.ts; sisi Go di
// backend/internal/httpapi.

const origin = "http://localhost:3101";
const headers = { Origin: origin };
const ticketSecret = process.env.REALTIME_TOKEN_SECRET ?? "";

interface Account {
  context: BrowserContext;
  request: APIRequestContext;
  email: string;
  id: string;
}

let pool: Pool;
let regular: Account;
let admin: Account;

// Host router yang dipakai tes ini (kolom host unik); dibersihkan sebelum dan
// sesudah. Port 1 tertutup: tidak ada yang mendengarkan di sana.
const closedHost = "127.0.0.1:1";
const deniedHost = "127.0.0.1:2";
const routerPassword = "Sandi-Router-Uji-123!";

async function setRole(email: string, role: string) {
  const { rowCount } = await pool.query(
    'UPDATE "user" SET role = $1 WHERE email = $2',
    [role, email],
  );
  expect(rowCount).toBe(1);
}

async function deleteTestRouters() {
  await pool.query("DELETE FROM routers WHERE host = ANY($1)", [
    [closedHost, deniedHost],
  ]);
}

async function routerCount(host: string) {
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM routers WHERE host = $1",
    [host],
  );
  return rows[0].n as number;
}

async function newAccount(browser: Browser, name: string): Promise<Account> {
  // signUp menunggu jendela batas laju pendaftaran bila perlu.
  const context = await browser.newContext({ baseURL: origin });
  await signUp(context, name);
  const session = await context.request.get("/api/auth/get-session");
  expect(session.status()).toBe(200);
  const { user } = await session.json();
  return {
    context,
    request: context.request,
    email: user.email as string,
    id: user.id as string,
  };
}

function decodeTicket(token: string) {
  const [encodedPayload, encodedSignature, ...rest] = token.split(".");
  expect(rest).toHaveLength(0);
  const payload = Buffer.from(encodedPayload, "base64url");
  const expected = createHmac("sha256", ticketSecret).update(payload).digest();
  // Tanda tangan harus benar atas byte payload persis seperti yang dikirim.
  expect(Buffer.from(encodedSignature, "base64url").equals(expected)).toBe(
    true,
  );
  return JSON.parse(payload.toString()) as {
    sub: string;
    exp: number;
    perms?: string[];
  };
}

async function ticketOf(account: Account, data?: unknown) {
  const response = await account.request.post("/api/realtime/ticket", {
    headers,
    ...(data === undefined ? {} : { data }),
  });
  expect(response.status()).toBe(200);
  const { data: ticket } = await response.json();
  return decodeTicket(ticket.token as string);
}

// Router tiruan yang mencatat setiap permintaan masuk. Dipakai untuk
// membuktikan dua hal: akun biasa ditolak tanpa ada koneksi keluar sama sekali,
// dan admin sungguh sampai ke penanganan semula (server menghubungi host itu).
interface FakeRouter {
  host: string;
  hits: Array<{ url: string; authorization: string | undefined }>;
  close: () => Promise<void>;
}

async function startFakeRouter(): Promise<FakeRouter> {
  const hits: FakeRouter["hits"] = [];
  const server: Server = createServer((req, res) => {
    hits.push({ url: req.url ?? "", authorization: req.headers.authorization });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ "board-name": "RB-uji", "cpu-load": 3 }));
  });
  await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
  const { port } = server.address() as AddressInfo;
  return {
    host: `127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise<void>((accept) => {
        server.closeAllConnections();
        server.close(() => accept());
      }),
  };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(90_000);
  pool = new Pool({
    connectionString: process.env.STARTER_TEST_DATABASE_URL,
    max: 2,
  });
  await deleteTestRouters();
  regular = await newAccount(browser, "Akun Hanya Lihat");
  admin = await newAccount(browser, "Akun Admin");
  await setRole(admin.email, "admin");
});

test.afterAll(async () => {
  try {
    await deleteTestRouters();
    // Kembalikan peran akun yang dinaikkan; basis data uji memang sekali pakai,
    // tetapi spesifikasi lain tidak boleh menemukan admin tersisa.
    if (admin) await setRole(admin.email, "user");
  } finally {
    await regular?.context.close();
    await admin?.context.close();
    await pool?.end();
  }
});

// Byte mentah (bukan string): Playwright mengubah string menjadi teks JSON bila
// tipe kontennya JSON, sehingga "{rusak" akan terkirim sebagai JSON yang sah.
const brokenJson = Buffer.from("{rusak");

const routerEndpoints = ["/api/routers", "/api/routers/test"];

// ---------------------------------------------------------------------------
// Tanpa sesi dan metode lain
// ---------------------------------------------------------------------------

test("anonim mendapat 401 di kedua endpoint router, dengan atau tanpa isi dan Origin", async ({
  request,
}) => {
  for (const url of routerEndpoints) {
    for (const options of [
      { headers, data: { host: closedHost } },
      { headers },
      { data: {} },
      {},
    ]) {
      const response = await request.post(url, options);
      expect(response.status(), url).toBe(401);
      expect((await response.json()).error.code).toBe("UNAUTHORIZED");
    }
  }
});

test("GET ke kedua endpoint router dijawab 405, juga untuk admin", async ({
  request,
}) => {
  for (const url of routerEndpoints) {
    expect((await request.get(url, { headers })).status(), url).toBe(405);
    expect(
      (await admin.request.get(url, { headers })).status(),
      `${url} admin`,
    ).toBe(405);
  }
});

// ---------------------------------------------------------------------------
// Akun biasa (hanya-lihat)
// ---------------------------------------------------------------------------

test("akun biasa mendapat 403 FORBIDDEN dengan isi apa pun, sebelum isi dibaca", async () => {
  const bodies: Array<{ name: string; options: Record<string, unknown> }> = [
    {
      name: "isi sah",
      options: {
        data: {
          name: "Router Uji",
          host: deniedHost,
          username: "admin",
          password: routerPassword,
        },
      },
    },
    { name: "objek kosong", options: { data: {} } },
    {
      name: "tanpa isi dan tanpa tipe konten",
      options: {},
    },
    {
      name: "JSON rusak",
      options: {
        headers: { ...headers, "Content-Type": "application/json" },
        data: brokenJson,
      },
    },
    {
      name: "JSON kosong",
      options: {
        headers: { ...headers, "Content-Type": "application/json" },
        data: Buffer.alloc(0),
      },
    },
    {
      name: "tipe konten salah",
      options: {
        headers: { ...headers, "Content-Type": "text/plain" },
        data: "halo",
      },
    },
    {
      name: "kolom asing",
      options: { data: { host: "a", username: "b", password: "c", x: 1 } },
    },
  ];
  for (const url of routerEndpoints) {
    for (const { name, options } of bodies) {
      const response = await regular.request.post(url, {
        ...options,
        headers: { ...headers, ...(options.headers as object | undefined) },
      });
      // 415, 400, 422 akan berarti isi dibaca lebih dulu; harus tetap 403.
      expect(response.status(), `${url} ${name}`).toBe(403);
      const body = await response.json();
      expect(body.error.code, `${url} ${name}`).toBe("FORBIDDEN");
      expect(response.headers()["cache-control"]).toContain("no-store");
    }
  }
  expect(await routerCount(deniedHost)).toBe(0);
});

test("akun biasa tidak membuat server menghubungi host mana pun lewat /api/routers/test", async () => {
  const fake = await startFakeRouter();
  try {
    const attempt = {
      host: fake.host,
      username: "admin",
      password: routerPassword,
    };
    const denied = await regular.request.post("/api/routers/test", {
      headers,
      data: attempt,
    });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error.code).toBe("FORBIDDEN");
    // Beri waktu bila ada koneksi yang terlambat; harus tetap nol.
    await new Promise((accept) => setTimeout(accept, 300));
    expect(fake.hits).toEqual([]);

    // Kendali positif: router tiruan itu memang terjangkau bagi admin, jadi
    // "nol" di atas berarti ditolak sebelum koneksi, bukan host tak terjangkau.
    const allowed = await admin.request.post("/api/routers/test", {
      headers,
      data: attempt,
    });
    expect(allowed.status()).toBe(200);
    expect(await allowed.json()).toEqual({
      success: true,
      data: { "board-name": "RB-uji", "cpu-load": 3 },
    });
    expect(fake.hits).toHaveLength(1);
    expect(fake.hits[0].url).toBe("/rest/system/resource");
    expect(fake.hits[0].authorization).toBe(
      `Basic ${Buffer.from(`admin:${routerPassword}`).toString("base64")}`,
    );
  } finally {
    await fake.close();
  }
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

test("admin dengan isi kosong lolos ke penanganan semula: 422 tanpa koneksi keluar, 400 untuk JSON rusak", async () => {
  for (const url of routerEndpoints) {
    const empty = await admin.request.post(url, { headers, data: {} });
    expect(empty.status(), url).toBe(422);
    expect((await empty.json()).error.code).toBe("VALIDATION_ERROR");

    const broken = await admin.request.post(url, {
      headers: { ...headers, "Content-Type": "application/json" },
      data: brokenJson,
    });
    expect(broken.status(), url).toBe(400);
    expect((await broken.json()).error.code).toBe("INVALID_JSON");

    const wrongType = await admin.request.post(url, {
      headers: { ...headers, "Content-Type": "text/plain" },
      data: "halo",
    });
    expect(wrongType.status(), url).toBe(415);
  }
});

test("Origin yang salah atau hilang ditolak 403 FORBIDDEN_ORIGIN, juga untuk admin", async () => {
  const data = {
    name: "Router Uji",
    host: closedHost,
    username: "admin",
    password: routerPassword,
  };
  for (const url of routerEndpoints) {
    for (const account of [admin, regular]) {
      const variants: Array<Record<string, string>> = [
        { Origin: "https://evil.example" },
        {},
        { ...headers, "Sec-Fetch-Site": "cross-site" },
      ];
      for (const requestHeaders of variants) {
        const response = await account.request.post(url, {
          headers: requestHeaders,
          data,
        });
        expect(
          response.status(),
          `${url} ${JSON.stringify(requestHeaders)}`,
        ).toBe(403);
        expect((await response.json()).error.code).toBe("FORBIDDEN_ORIGIN");
      }
    }
  }
  expect(await routerCount(closedHost)).toBe(0);
});

test("admin menambah router: 201 dan jawaban tidak memuat kata sandi dalam bentuk apa pun", async () => {
  await deleteTestRouters();
  try {
    const response = await admin.request.post("/api/routers", {
      headers,
      data: {
        name: "Router Uji Izin",
        host: closedHost,
        username: "petugas",
        password: routerPassword,
      },
    });
    const text = await response.text();
    expect(response.status(), text).toBe(201);

    const { data } = JSON.parse(text);
    expect(response.headers().location).toBe(`/api/routers/${data.id}`);
    // Hanya kolom ini, tidak lebih.
    expect(Object.keys(data).sort()).toEqual(
      [
        "createdAt",
        "host",
        "id",
        "lastSeenAt",
        "name",
        "status",
        "username",
      ].sort(),
    );
    expect(data).toMatchObject({
      name: "Router Uji Izin",
      host: closedHost,
      username: "petugas",
      status: "aktif",
      lastSeenAt: null,
    });
    expect(Number.isNaN(Date.parse(data.createdAt))).toBe(false);

    // Periksa teks mentah, bukan hanya kunci yang dikenal: tidak ada nama
    // kolom, kata sandi asli, maupun hasil enkripsinya yang tersimpan.
    const { rows } = await pool.query(
      "SELECT password_enc FROM routers WHERE id = $1",
      [data.id],
    );
    expect(rows).toHaveLength(1);
    const stored = rows[0].password_enc as string;
    expect(stored.length).toBeGreaterThan(10);
    expect(stored).not.toContain(routerPassword);
    for (const forbidden of [
      "passwordEnc",
      "password_enc",
      "password",
      routerPassword,
      stored,
      ...stored.split(":"),
    ]) {
      expect(text, `jawaban memuat ${forbidden.slice(0, 20)}`).not.toContain(
        forbidden,
      );
    }
  } finally {
    await deleteTestRouters();
  }
});

// ---------------------------------------------------------------------------
// Peran dicabut
// ---------------------------------------------------------------------------

test("peran yang dicabut langsung ditolak di kedua endpoint, dan pulih saat dikembalikan", async () => {
  await setRole(admin.email, "user");
  try {
    for (const url of routerEndpoints) {
      const response = await admin.request.post(url, { headers, data: {} });
      expect(response.status(), url).toBe(403);
      expect((await response.json()).error.code).toBe("FORBIDDEN");
    }
    // Tiket baru tidak lagi membawa izin.
    expect((await ticketOf(admin)).perms).toBeUndefined();
  } finally {
    await setRole(admin.email, "admin");
  }
  expect(
    (
      await admin.request.post("/api/routers/test", { headers, data: {} })
    ).status(),
  ).toBe(422);
  expect((await ticketOf(admin)).perms).toEqual(["alert:handle"]);
});

// ---------------------------------------------------------------------------
// Tiket realtime
// ---------------------------------------------------------------------------

test("tiket realtime: anonim 401 dan Origin asing 403, tanpa tiket", async ({
  request,
}) => {
  expect(ticketSecret.length).toBeGreaterThanOrEqual(32); // dari npm run test:e2e
  const anonymous = await request.post("/api/realtime/ticket", { headers });
  expect(anonymous.status()).toBe(401);
  expect((await anonymous.json()).error.code).toBe("UNAUTHORIZED");

  const crossSite = await admin.request.post("/api/realtime/ticket", {
    headers: { Origin: "https://evil.example" },
  });
  expect(crossSite.status()).toBe(403);
  expect((await crossSite.json()).error.code).toBe("FORBIDDEN_ORIGIN");
});

test("tiket akun biasa tidak memuat alert:handle, tiket admin memuatnya", async () => {
  const regularClaims = await ticketOf(regular);
  expect(regularClaims.sub).toBe(regular.id);
  expect(regularClaims.perms ?? []).not.toContain("alert:handle");
  // Tanpa izin berarti tanpa kunci perms sama sekali (tiket seperti dulu).
  expect(Object.keys(regularClaims).sort()).toEqual(["exp", "sub"]);

  const adminClaims = await ticketOf(admin);
  expect(adminClaims.sub).toBe(admin.id);
  expect(adminClaims.perms).toEqual(["alert:handle"]);
  expect(Object.keys(adminClaims).sort()).toEqual(["exp", "perms", "sub"]);
});

test("izin di tiket ditentukan peran di database, bukan kiriman klien", async () => {
  // Isi permintaan, header, dan kueri yang mengaku punya izin diabaikan.
  const response = await regular.request.post(
    "/api/realtime/ticket?perms=alert:handle",
    {
      headers: { ...headers, "X-Perms": "alert:handle" },
      data: { perms: ["alert:handle"], role: "admin" },
    },
  );
  expect(response.status()).toBe(200);
  const { data } = await response.json();
  expect(decodeTicket(data.token).perms).toBeUndefined();
  expect(JSON.stringify(data)).not.toContain("alert:handle");
});
