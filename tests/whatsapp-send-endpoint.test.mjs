import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL = "http://localhost:3101";
delete process.env.WHATSAPP_API_KEY;

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

// DB palsu lewat slot global src/db/index.ts: tanpa jaringan.
const RID = "11111111-1111-4111-8111-111111111111";
let recipients = [];
let logs = [];
let audits = [];
let seq = 0;
const thenable = (get) => {
  const c = {
    from: () => c,
    where: () => c,
    orderBy: () => c,
    then: (a, b) => Promise.resolve(get()).then(a, b),
  };
  return c;
};
globalThis.starterPostgresDb = {
  select: () => thenable(() => recipients),
  insert: () => ({
    values: (v) => {
      // log WhatsApp punya recipientTarget; selain itu jejak audit
      if (!("recipientTarget" in v)) {
        audits.push(v);
        return Promise.resolve();
      }
      const row = { id: `log-${++seq}`, ...v };
      logs.push(row);
      return { returning: async () => [{ id: row.id }] };
    },
  }),
  update: () => ({
    set: (v) => ({
      where: async () => {
        Object.assign(logs[logs.length - 1], v);
      },
    }),
  }),
};

register();
const route = await import("../src/app/api/whatsapp/send/route.ts");
const logsRoute = await import("../src/app/api/whatsapp/logs/route.ts");
const { auth } = await import("../src/lib/auth.ts");

const ORIGIN = "http://localhost:3101";
const post = (body) =>
  new Request(`${ORIGIN}/api/whatsapp/send`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

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

test.beforeEach(() => {
  recipients = [];
  logs = [];
  audits = [];
  seq = 0;
});

test("tanpa sesi -> 401", async () => {
  assert.equal(
    (await route.POST(post({ message: "x", target: "081234567890" }))).status,
    401,
  );
});

test("pesan kosong -> 400 validation_error", async () => {
  await signedIn(async () => {
    const res = await route.POST(
      post({ message: "   ", target: "081234567890" }),
    );
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "validation_error");
    assert.equal(logs.length, 0);
  });
});

test("tanpa target & recipientId saat broadcast=false -> 400", async () => {
  await signedIn(async () => {
    const res = await route.POST(post({ message: "halo" }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "validation_error");
    assert.match(body.message, /target|recipientId|broadcast/);
    assert.equal(logs.length, 0);
  });
});

test("nomor tidak valid -> 400", async () => {
  await signedIn(async () => {
    assert.equal(
      (await route.POST(post({ message: "halo", target: "123" }))).status,
      400,
    );
    assert.equal(logs.length, 0);
  });
});

test("kirim tunggal -> 200, log 'sent' tercatat, audit ditulis", async () => {
  await signedIn(async () => {
    const res = await route.POST(
      post({ message: "Tes", target: "081234567890", alertKind: "test" }),
    );
    assert.equal(res.status, 200);
    const { ok, data } = await res.json();
    assert.equal(ok, true);
    assert.equal(data.logId, "log-1");
    assert.equal(data.target, "6281234567890");
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, "sent");
    assert.equal(logs[0].alertKind, "test");
    assert.equal(logs[0].message, "Tes");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "whatsapp_send");
    assert.equal(audits[0].userId, "u1");
  });
});

test("via recipientId memakai target & nama penerima", async () => {
  recipients = [
    {
      id: RID,
      name: "Piket",
      target: "6281234567890",
      type: "individual",
      isActive: true,
    },
  ];
  await signedIn(async () => {
    const res = await route.POST(post({ message: "Tes", recipientId: RID }));
    assert.equal(res.status, 200);
    assert.equal(logs[0].recipientId, RID);
    assert.equal(logs[0].recipientName, "Piket");
    assert.equal(logs[0].recipientTarget, "6281234567890");
  });
});

test("broadcast -> semua penerima aktif, satu log per penerima", async () => {
  recipients = [
    {
      id: RID,
      name: "A",
      target: "6281234567890",
      type: "individual",
      isActive: true,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "B",
      target: "6289876543210",
      type: "individual",
      isActive: true,
    },
  ];
  await signedIn(async () => {
    const res = await route.POST(
      post({ message: "Semua", broadcast: true, alertKind: "offline" }),
    );
    assert.equal(res.status, 200);
    const { ok, data } = await res.json();
    assert.equal(ok, true);
    assert.equal(data.broadcast, true);
    assert.equal(data.totalSent, 2);
    assert.equal(data.totalFailed, 0);
    assert.equal(data.logs.length, 2);
    assert.equal(logs.length, 2);
    assert.ok(
      logs.every((l) => l.status === "sent" && l.alertKind === "offline"),
    );
    assert.equal(audits[0].detail.totalSent, 2);
  });
});

test("gateway gagal -> log 'failed' dengan error tersimpan", async () => {
  process.env.WHATSAPP_API_KEY = "kunci-uji";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  try {
    await signedIn(async () => {
      const res = await route.POST(
        post({ message: "Tes", target: "081234567890" }),
      );
      assert.equal(res.status, 200);
      const { ok, data } = await res.json();
      assert.equal(ok, false);
      assert.equal(data.error, "Gateway membalas HTTP 500.");
      assert.equal(logs.length, 1);
      assert.equal(logs[0].status, "failed");
      assert.equal(logs[0].error, "Gateway membalas HTTP 500.");
    });
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.WHATSAPP_API_KEY;
  }
});

test("POST /api/whatsapp/logs mendelegasikan ke logika kirim", async () => {
  assert.equal(typeof logsRoute.POST, "function");
  await signedIn(async () => {
    const res = await logsRoute.POST(
      post({ message: "Tes", target: "081234567890" }),
    );
    assert.equal(res.status, 200);
    assert.equal(logs.length, 1);
  });
});
