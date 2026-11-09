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
      if (v?.action) audits.push(v);
    },
  }),
  update: () => ({
    set: (v) => ({
      where: () => ({
        returning: async () => {
          if (!row) return [];
          // markAlertHandled mengubah status; hanya baris aktif yang cocok.
          if (
            v.status === "handled" &&
            (row.endedAt || row.status !== "active")
          )
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
const ticket = await import("../src/app/api/alerts/[id]/ticket/route.ts");
const alertsSvc = await import("../src/services/alerts.service.ts");
const { auth } = await import("../src/lib/auth.ts");

const ORIGIN = "http://localhost:3101";
const get = (id) => new Request(`${ORIGIN}/api/alerts/${id}/ticket`);
const post = (id, body) =>
  new Request(`${ORIGIN}/api/alerts/${id}/ticket`, {
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
  assert.equal((await ticket.GET(get(ID), ctx(ID))).status, 401);
});

test("GET alert tidak ada -> 404", async () => {
  row = null;
  await signedIn(async () => {
    const res = await ticket.GET(get(MISSING), ctx(MISSING));
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "not_found");
    assert.equal(body.message, "Alert tidak ditemukan.");
  });
});

test("GET alert ada -> 200 AlertTicketResponseRecord lengkap", async () => {
  row = mkRow({
    ticketStatus: "in_progress",
    ticketPriority: "high",
    ticketNotes: "Cek ODP",
    actionTaken: "Ganti patchcord",
    dispatchTechnician: true,
    technicianName: "Andi",
    handledBy: "Budi",
    updatedAt: new Date("2026-01-02T03:04:05Z"),
  });
  await signedIn(async () => {
    const res = await ticket.GET(get(ID), ctx(ID));
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.deepEqual(data, {
      id: ID,
      alertId: ID,
      status: "in_progress",
      priority: "high",
      operator: "Budi",
      notes: "Cek ODP",
      respondedAt: "2026-01-02T03:04:05.000Z",
      actionTaken: "Ganti patchcord",
      dispatchTechnician: true,
      technicianName: "Andi",
    });
  });
});

test("GET baris default -> operator 'Operator', notes kosong", async () => {
  row = mkRow();
  const data = await alertsSvc.getAlertTicket(ID);
  assert.equal(data.operator, "Operator");
  assert.equal(data.notes, "");
  assert.equal(data.dispatchTechnician, false);
  assert.equal(data.actionTaken, undefined);
  assert.equal(data.technicianName, undefined);
});

test("GET demo + tabel kosong: id data tiruan -> tiket bawaan", async () => {
  row = null;
  const { getAlertsList } = alertsSvc;
  const { items } = await getAlertsList({ status: "active", limit: 1 });
  if (items.length === 0) return;
  const data = await alertsSvc.getAlertTicket(items[0].id);
  assert.equal(data.alertId, items[0].id);
  assert.equal(data.status, "open");
});

test("POST tanpa sesi -> 401", async () => {
  const res = await ticket.POST(post(ID, validTicket), ctx(ID));
  assert.equal(res.status, 401);
});

test("POST catatan < 5 karakter -> 400", async () => {
  row = mkRow();
  await signedIn(async () => {
    const res = await ticket.POST(
      post(ID, { ...validTicket, notes: "abc" }),
      ctx(ID),
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "validation_error");
    assert.ok(body.details.length > 0);
  });
});

test("POST dispatch tanpa nama teknisi -> 400", async () => {
  row = mkRow();
  await signedIn(async () => {
    const res = await ticket.POST(
      post(ID, {
        ...validTicket,
        dispatchTechnician: true,
        technicianName: "",
      }),
      ctx(ID),
    );
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "validation_error");
  });
});

test("POST alert tidak ada -> 404", async () => {
  row = null;
  await signedIn(async () => {
    const res = await ticket.POST(post(MISSING, validTicket), ctx(MISSING));
    assert.equal(res.status, 404);
  });
});

test("POST valid -> 200 { ok, data } dan audit", async () => {
  row = mkRow();
  audits.length = 0;
  await signedIn(async () => {
    const res = await ticket.POST(
      post(ID, {
        ...validTicket,
        actionTaken: "Cek ODP",
        dispatchTechnician: true,
        technicianName: "Andi",
      }),
      ctx(ID),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.alertId, ID);
    assert.equal(body.data.status, "in_progress");
    assert.equal(body.data.priority, "high");
    assert.equal(body.data.notes, "Teknisi menuju lokasi");
    assert.equal(body.data.actionTaken, "Cek ODP");
    assert.equal(body.data.dispatchTechnician, true);
    assert.equal(body.data.technicianName, "Andi");
    assert.equal(row.status, "active"); // belum resolved
    assert.equal(audits.at(-1).action, "ticket_update");
    assert.equal(audits.at(-1).target, ID);
  });
});

test("POST status resolved -> alert ikut handled oleh operator", async () => {
  row = mkRow();
  await signedIn(async () => {
    const res = await ticket.POST(
      post(ID, { ...validTicket, status: "resolved" }),
      ctx(ID),
    );
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.equal(data.status, "resolved");
    assert.equal(data.operator, "Budi");
    assert.equal(row.status, "handled");
    assert.equal(row.endTimeSource, "operator");
    assert.equal(row.handledBy, "Budi");
    assert.ok(row.endedAt instanceof Date);
  });
});

test("POST resolved pada alert yang sudah selesai -> tidak ditimpa", async () => {
  const ended = new Date("2026-01-01T01:00:00Z");
  row = mkRow({ status: "handled", endedAt: ended, handledBy: "Sari" });
  await signedIn(async () => {
    const res = await ticket.POST(
      post(ID, { ...validTicket, status: "resolved" }),
      ctx(ID),
    );
    assert.equal(res.status, 200);
    assert.equal(row.handledBy, "Sari");
    assert.equal(row.endedAt, ended);
  });
});
