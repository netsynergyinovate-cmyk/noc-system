import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DASHBOARD_DATA = "live";
process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";
delete process.env.WHATSAPP_API_KEY; // tanpa kunci = pengiriman disimulasikan

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();
const schema = await import("../src/db/schema/index.ts");
const { alerts, whatsappLogs, whatsappRecipients } = schema;

const ID = "11111111-1111-4111-8111-111111111111";
const MISSING = "22222222-2222-4222-8222-222222222222";
const T0 = new Date("2026-01-01T00:00:00Z");

const recipients = [
  { id: "r1", name: "Piket", target: "628111111111", isActive: true },
  { id: "r2", name: "Grup", target: "628222222222", isActive: true },
];
let alertRow = null;
const logs = [];

const baseAlert = (over = {}) => ({
  id: ID,
  routerId: null,
  customerId: null,
  type: "offline",
  severity: "critical",
  status: "active",
  title: "ONU mati",
  message: "Pelanggan offline",
  startedAt: T0,
  detectedAt: T0,
  endedAt: null,
  timeSource: "poll",
  timeUncertaintySeconds: 0,
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

const rowsFor = (table) =>
  table === whatsappRecipients
    ? recipients
    : table === alerts
      ? alertRow
        ? [alertRow]
        : []
      : [];

const thenable = (get) => {
  const c = {
    where: () => c,
    orderBy: () => c,
    limit: () => c,
    offset: () => c,
    then: (res, rej) => Promise.resolve(get()).then(res, rej),
  };
  return c;
};

const fakeDb = {
  select: () => ({ from: (table) => thenable(() => rowsFor(table)) }),
  insert: (table) => ({
    values: (v) => {
      const run = () => {
        if (table === whatsappLogs) {
          const l = { id: `log${logs.length + 1}`, status: "pending", ...v };
          logs.push(l);
          return [l];
        }
        if (table === alerts) {
          alertRow = baseAlert({ ...v, id: ID });
          return [alertRow];
        }
        return []; // audit_log
      };
      return {
        returning: async () => run(),
        then: (res, rej) => Promise.resolve(run()).then(res, rej),
      };
    },
  }),
  update: (table) => ({
    set: (v) => ({
      where: () => {
        const run = () => {
          if (table === whatsappLogs) {
            // sendWhatsappMessage hanya memperbarui log terakhir yang masih pending.
            const l = [...logs].reverse().find((x) => x.status === "pending");
            if (l) Object.assign(l, v);
            return [];
          }
          if (table === alerts && alertRow) {
            alertRow = { ...alertRow, ...v };
            return [alertRow];
          }
          return [];
        };
        return {
          returning: async () => run(),
          then: (res, rej) => Promise.resolve(run()).then(res, rej),
        };
      },
    }),
  }),
};
fakeDb.transaction = async (fn) => fn(fakeDb);
globalThis.starterPostgresDb = fakeDb;

const svc = await import("../src/services/alerts.service.ts");
const notify = await import("../src/app/api/alerts/[id]/notify/route.ts");
const { auth } = await import("../src/lib/auth.ts");

const ORIGIN = "http://localhost:3101";
const post = (path) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: "{}",
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

const reset = () => {
  alertRow = null;
  logs.length = 0;
};

test("createAlert critical -> kirim ke semua penerima aktif + log tercatat", async () => {
  reset();
  const res = await svc.createAlert({
    type: "offline",
    severity: "critical",
    title: "ONU mati",
    message: "Pelanggan offline",
    locationName: "ODP-1",
  });
  assert.equal(res.ok, true);
  assert.equal(res.data.id, ID);
  assert.deepEqual(res.whatsapp, { sent: 2, failed: 0 });
  assert.equal(logs.length, 2);
  assert.deepEqual(logs.map((l) => l.recipientTarget).sort(), [
    "628111111111",
    "628222222222",
  ]);
  assert.ok(
    logs.every((l) => l.status === "sent" && l.alertKind === "offline"),
  );
  assert.match(logs[0].message, /NOC ALERT/);
  assert.match(logs[0].message, /Jenis: offline/);
  assert.match(logs[0].message, /Perangkat: ODP-1/);
  assert.match(logs[0].message, /Kondisi: Pelanggan offline/);
});

test("createAlert warning ikut dikirim", async () => {
  reset();
  const res = await svc.createAlert({
    type: "cpu",
    severity: "warning",
    title: "CPU tinggi",
    message: "CPU 90%",
  });
  assert.equal(res.whatsapp.sent, 2);
});

test("createAlert info -> tidak ada notifikasi", async () => {
  reset();
  const res = await svc.createAlert({
    type: "queue",
    severity: "info",
    title: "Info",
    message: "Antrian naik",
  });
  assert.equal(res.ok, true);
  assert.equal(res.whatsapp.sent, 0);
  assert.equal(logs.length, 0);
});

test("createAlert: input tidak valid ditolak tanpa menyimpan", async () => {
  reset();
  const res = await svc.createAlert({
    type: "x",
    severity: "y",
    title: " ",
    message: "",
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, "validation_error");
  assert.equal(alertRow, null);
  assert.equal(logs.length, 0);
});

test("updateAlertTicket dispatchTechnician -> pesan penugasan tercatat", async () => {
  reset();
  alertRow = baseAlert();
  const res = await svc.updateAlertTicket(
    ID,
    {
      status: "in_progress",
      priority: "high",
      notes: "Teknisi menuju lokasi",
      dispatchTechnician: true,
      technicianName: "Andi",
    },
    "Budi",
    "u1",
  );
  assert.equal(res.ok, true);
  assert.equal(logs.length, 2);
  assert.match(logs[0].message, /PENUGASAN TEKNISI NOC/);
  assert.match(logs[0].message, /Alert: offline \(critical\)/);
  assert.match(logs[0].message, /Teknisi: Andi/);
  assert.match(logs[0].message, /Catatan: Teknisi menuju lokasi/);
});

test("updateAlertTicket tanpa dispatch -> tidak ada pesan", async () => {
  reset();
  alertRow = baseAlert();
  const res = await svc.updateAlertTicket(
    ID,
    { status: "in_progress", priority: "high", notes: "Sedang dicek" },
    "Budi",
  );
  assert.equal(res.ok, true);
  assert.equal(logs.length, 0);
});

test("notify tanpa sesi -> 401", async () => {
  const res = await notify.POST(post(`/api/alerts/${ID}/notify`), ctx(ID));
  assert.equal(res.status, 401);
});

test("notify: alert tidak ada -> 404", async () => {
  reset();
  await signedIn(async () => {
    const res = await notify.POST(
      post(`/api/alerts/${MISSING}/notify`),
      ctx(MISSING),
    );
    assert.equal(res.status, 404);
    const bad = await notify.POST(post("/api/alerts/abc/notify"), ctx("abc"));
    assert.equal(bad.status, 404);
  });
});

test("notify: alert ada -> 200 dengan jumlah terkirim", async () => {
  reset();
  alertRow = baseAlert();
  await signedIn(async () => {
    const res = await notify.POST(post(`/api/alerts/${ID}/notify`), ctx(ID));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, sent: 2, failed: 0 });
    assert.equal(logs.length, 2);
  });
});
