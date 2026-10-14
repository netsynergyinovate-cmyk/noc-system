import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DASHBOARD_DATA = "demo";
process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

// DB palsu (tanpa jaringan) lewat slot global yang dipakai src/db/index.ts.
// Tabel alerts kosong => daftar jatuh ke data tiruan (mode demo).
const ID = "11111111-1111-4111-8111-111111111111";
const MISSING = "22222222-2222-4222-8222-222222222222";
const T0 = new Date("2026-01-01T00:00:00Z");
let row = null; // satu baris alerts, atau null
const audits = [];

const mkRow = (over = {}) => ({
  id: ID,
  routerId: null,
  customerId: null,
  type: "offline",
  severity: "critical",
  status: "active",
  title: null,
  message: null,
  startedAt: T0,
  detectedAt: T0,
  endedAt: null,
  timeSource: "poll",
  timeUncertaintySeconds: 30,
  endTimeSource: null,
  endTimeUncertaintySeconds: 0,
  handledBy: null,
  handledAt: null,
  locationName: "ODP-1",
  locationAddress: null,
  locationOdp: "ODP-1",
  latitude: null,
  longitude: null,
  detail: {},
  ticketStatus: "open",
  ticketPriority: "medium",
  ticketNotes: null,
  actionTaken: null,
  dispatchTechnician: false,
  technicianName: null,
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

const thenable = (get) => {
  const c = {
    from: () => c,
    where: () => c,
    orderBy: () => c,
    limit: () => c,
    offset: () => c,
    then: (res, rej) => Promise.resolve(get()).then(res, rej),
  };
  return c;
};

const fakeDb = {
  select: (fields) =>
    fields && ("n" in fields || "total" in fields)
      ? thenable(() => [{ n: row ? 1 : 0, total: row ? 1 : 0 }])
      : thenable(() => (row ? [{ id: row.id, ...row }] : [])),
  insert: () => ({
    values: async (v) => {
      // Hanya baris audit; log WhatsApp (dispatch teknisi) bukan urusan tes ini.
      if ("action" in v) audits.push(v);
    },
  }),
  update: () => ({
    set: (v) => ({
      where: () => ({
        returning: async () => {
          if (!row) return [];
          // markAlertHandled mengubah status; hanya baris aktif yang cocok.
          if (v.status === "handled" && (row.endedAt || row.status !== "active"))
            return [];
          row = { ...row, ...v };
          return [row];
        },
      }),
    }),
  }),
};
fakeDb.transaction = async (fn) => fn(fakeDb);
globalThis.starterPostgresDb = fakeDb;

register();
const list = await import("../src/app/api/alerts/route.ts");
const handle = await import("../src/app/api/alerts/[id]/handle/route.ts");
const ticket = await import("../src/app/api/alerts/[id]/ticket/route.ts");
const { auth } = await import("../src/lib/auth.ts");

const ORIGIN = "http://localhost:3101";
const get = (qs = "") => new Request(`${ORIGIN}/api/alerts${qs}`);
const post = (path, body) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
const ctx = (id) => ({ params: Promise.resolve({ id }) });

async function signedIn(fn) {
  const original = auth.api.getSession;
  auth.api.getSession = async () => ({
    session: { id: "s1" },
    user: { id: "u1", name: "Budi", email: "b@x.id", role: "user" },
  });
  try {
    await fn();
  } finally {
    auth.api.getSession = original;
  }
}

const validTicket = {
  status: "in_progress",
  priority: "high",
  notes: "Teknisi menuju lokasi",
};

test("GET tanpa sesi -> 401", async () => {
  assert.equal((await list.GET(get())).status, 401);
});

test("GET dengan sesi -> 200 { data, meta }", async () => {
  row = null;
  await signedIn(async () => {
    const res = await list.GET(get("?limit=5"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data));
    assert.ok(body.data.length <= 5);
    assert.equal(body.meta.status, "all");
    assert.equal(body.meta.limit, 5);
    assert.equal(body.meta.offset, 0);
    assert.equal(typeof body.meta.total, "number");
  });
});

test("GET ?status=active dan ?status=resolved menyaring", async () => {
  row = null;
  await signedIn(async () => {
    const a = await (await list.GET(get("?status=active&limit=200"))).json();
    assert.ok(a.data.every((x) => x.endedAt === null));
    const r = await (await list.GET(get("?status=resolved&limit=200"))).json();
    assert.ok(r.data.length > 0);
    assert.ok(r.data.every((x) => typeof x.endedAt === "number"));
    for (let i = 1; i < r.data.length; i++)
      assert.ok(r.data[i - 1].endedAt >= r.data[i].endedAt);
    assert.equal(r.meta.status, "resolved");
  });
});

test("GET parameter tidak valid -> 400", async () => {
  await signedIn(async () => {
    for (const qs of ["?status=x", "?type=x", "?severity=x", "?limit=0", "?limit=abc"])
      assert.equal((await list.GET(get(qs))).status, 400, qs);
  });
});

test("handle tanpa sesi -> 401", async () => {
  const res = await handle.POST(post(`/api/alerts/${ID}/handle`), ctx(ID));
  assert.equal(res.status, 401);
});

test("handle: aktif -> 200, lalu 409 not_active, audit tercatat", async () => {
  row = mkRow();
  audits.length = 0;
  await signedIn(async () => {
    const res = await handle.POST(post(`/api/alerts/${ID}/handle`), ctx(ID));
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.equal(data.status, "handled");
    assert.equal(data.handledBy, "Budi");
    assert.equal(data.endTimeSource, "operator");
    assert.equal(typeof data.endedAt, "number");
    assert.equal(audits.at(-1).action, "alert_handle");
    assert.equal(audits.at(-1).target, ID);

    const again = await handle.POST(post(`/api/alerts/${ID}/handle`), ctx(ID));
    assert.equal(again.status, 409);
    const body = await again.json();
    assert.equal(body.error, "not_active");
    assert.equal(body.message, "Alert sudah tidak aktif.");
  });
});

test("handle: alert tidak ada -> 404", async () => {
  row = null;
  await signedIn(async () => {
    const res = await handle.POST(post(`/api/alerts/${MISSING}/handle`), ctx(MISSING));
    assert.equal(res.status, 404);
  });
});

test("ticket tanpa sesi -> 401", async () => {
  const res = await ticket.POST(post(`/api/alerts/${ID}/ticket`, validTicket), ctx(ID));
  assert.equal(res.status, 401);
});

test("ticket: catatan < 5 karakter -> 400 validation_error", async () => {
  row = mkRow();
  await signedIn(async () => {
    const res = await ticket.POST(
      post(`/api/alerts/${ID}/ticket`, { ...validTicket, notes: "abc" }),
      ctx(ID),
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "validation_error");
    assert.ok(body.details.length > 0);
  });
});

test("ticket: status/prioritas tidak valid -> 400", async () => {
  row = mkRow();
  await signedIn(async () => {
    const res = await ticket.POST(
      post(`/api/alerts/${ID}/ticket`, { ...validTicket, status: "x", priority: "y" }),
      ctx(ID),
    );
    assert.equal(res.status, 400);
  });
});

test("ticket: teknisi dikirim tanpa nama -> 400", async () => {
  row = mkRow();
  await signedIn(async () => {
    const res = await ticket.POST(
      post(`/api/alerts/${ID}/ticket`, { ...validTicket, dispatchTechnician: true }),
      ctx(ID),
    );
    assert.equal(res.status, 400);
  });
});

test("ticket: input valid -> 200, kolom tiket & audit diperbarui", async () => {
  row = mkRow();
  audits.length = 0;
  await signedIn(async () => {
    const res = await ticket.POST(
      post(`/api/alerts/${ID}/ticket`, {
        ...validTicket,
        actionTaken: "Cek ODP",
        dispatchTechnician: true,
        technicianName: "Andi",
      }),
      ctx(ID),
    );
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.equal(data.status, "in_progress");
    assert.equal(data.priority, "high");
    assert.equal(data.notes, "Teknisi menuju lokasi");
    assert.equal(data.actionTaken, "Cek ODP");
    assert.equal(data.dispatchTechnician, true);
    assert.equal(data.technicianName, "Andi");
    assert.equal(audits.at(-1).action, "ticket_update");
    assert.equal(audits.at(-1).target, ID);
  });
});
