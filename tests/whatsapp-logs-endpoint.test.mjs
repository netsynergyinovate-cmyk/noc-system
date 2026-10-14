import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:1/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL = "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

// DB palsu: mencatat query; where dirender ke SQL asli agar filter bisa diperiksa.
let queries = [];
let rows = [];
let total = 0;
let statusRows = [];
let dialect;
const chain = (q) => {
  const c = {
    from: () => c,
    where: (w) => ((q.where = w && dialect.sqlToQuery(w)), c),
    orderBy: () => c,
    groupBy: () => ((q.kind = "summary"), c),
    limit: (n) => ((q.limit = n), c),
    offset: (n) => ((q.offset = n), c),
    then: (a, b) =>
      Promise.resolve(
        q.kind === "summary" ? statusRows : q.kind === "count" ? [{ total }] : rows,
      ).then(a, b),
  };
  return c;
};
globalThis.starterPostgresDb = {
  select: (fields) => {
    const q = { kind: fields && "total" in fields ? "count" : "list" };
    queries.push(q);
    return chain(q);
  },
};

register();
const { PgDialect } = await import("drizzle-orm/pg-core");
dialect = new PgDialect();
const { listWhatsappLogsSchema: s, summarizeLogCounts: sum } = await import(
  "../src/validators/whatsapp.ts"
);
const { GET } = await import("../src/app/api/whatsapp/logs/route.ts");
const { auth } = await import("../src/lib/auth.ts");

const get = (qs = "") =>
  new Request(`http://localhost:3101/api/whatsapp/logs${qs}`, { method: "GET" });

async function signedIn(fn) {
  const original = auth.api.getSession;
  auth.api.getSession = async () => ({
    session: { id: "s1" },
    user: { id: "u1", name: "Budi", email: "b@x.id", role: "user" },
  });
  try {
    return await fn();
  } finally {
    auth.api.getSession = original;
  }
}

test.beforeEach(() => {
  queries = [];
  rows = [];
  total = 0;
  statusRows = [];
});

test("filter: default, status, q", () => {
  assert.deepEqual(s.parse({}), { limit: 50, offset: 0 });
  for (const status of ["pending", "sent", "failed"])
    assert.equal(s.parse({ status }).status, status);
  assert.ok(!s.safeParse({ status: "delivered" }).success);
  assert.equal(s.parse({ q: "budi", alertKind: "offline" }).q, "budi");
});

test("limit/offset: coerce dan batas", () => {
  assert.equal(s.parse({ limit: "200", offset: "5" }).limit, 200);
  assert.equal(s.parse({ limit: "200", offset: "5" }).offset, 5);
  assert.ok(!s.safeParse({ limit: "201" }).success);
  assert.ok(!s.safeParse({ limit: "0" }).success);
  assert.ok(!s.safeParse({ offset: "-1" }).success);
  assert.ok(!s.safeParse({ limit: "1.5" }).success);
  assert.ok(!s.safeParse({ limit: "abc" }).success);
});

test("ringkasan: sent, failed, failureRate", () => {
  assert.deepEqual(sum({ sent: 3, failed: 1, pending: 2 }), {
    totalSent: 3,
    totalFailed: 1,
    totalPending: 2,
    failureRate: 25,
  });
  assert.equal(sum({ sent: 0, failed: 0, pending: 4 }).failureRate, 0);
  assert.equal(sum({ sent: 2, failed: 1, pending: 0 }).failureRate, 33.3);
  assert.equal(sum({ sent: 0, failed: 5, pending: 0 }).failureRate, 100);
});

test("GET tanpa sesi -> 401, DB tidak disentuh", async () => {
  const res = await GET(get());
  assert.equal(res.status, 401);
  assert.equal(queries.length, 0);
});

test("GET login -> 200 { logs, total, summary }", async () => {
  rows = [{ id: "l1", status: "sent" }, { id: "l2", status: "failed" }];
  total = 2;
  statusRows = [
    { status: "sent", n: 3 },
    { status: "failed", n: 1 },
    { status: "pending", n: 2 },
  ];
  await signedIn(async () => {
    const res = await GET(get());
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.deepEqual(Object.keys(data).sort(), ["logs", "summary", "total"]);
    assert.deepEqual(data.logs.map((l) => l.id), ["l1", "l2"]);
    assert.equal(data.total, 2);
    assert.deepEqual(data.summary, {
      totalSent: 3,
      totalFailed: 1,
      totalPending: 2,
      failureRate: 25,
    });
    const list = queries.find((q) => q.kind === "list");
    assert.equal(list.where, undefined); // tanpa filter
    assert.equal(list.limit, 50);
    assert.equal(list.offset, 0);
  });
});

test("summary kosong -> semua nol", async () => {
  await signedIn(async () => {
    const { data } = await (await GET(get())).json();
    assert.deepEqual(data.summary, {
      totalSent: 0,
      totalFailed: 0,
      totalPending: 0,
      failureRate: 0,
    });
    assert.deepEqual(data.logs, []);
    assert.equal(data.total, 0);
  });
});

for (const status of ["sent", "failed"]) {
  test(`?status=${status} -> where status, list dan count sama`, async () => {
    await signedIn(async () => {
      assert.equal((await GET(get(`?status=${status}`))).status, 200);
      for (const kind of ["list", "count"]) {
        const q = queries.find((x) => x.kind === kind);
        assert.match(q.where.sql, /"status" = \$1/);
        assert.deepEqual(q.where.params, [status]);
      }
    });
  });
}

test("?alertKind=offline -> where alert_kind", async () => {
  await signedIn(async () => {
    assert.equal((await GET(get("?alertKind=offline"))).status, 200);
    const q = queries.find((x) => x.kind === "list");
    assert.match(q.where.sql, /"alert_kind" = \$1/);
    assert.deepEqual(q.where.params, ["offline"]);
  });
});

test("?q=budi -> ilike nama/target/pesan, wildcard di-escape", async () => {
  await signedIn(async () => {
    await GET(get("?q=budi"));
    const q = queries.find((x) => x.kind === "list");
    assert.equal((q.where.sql.match(/ilike/g) ?? []).length, 3);
    assert.deepEqual(q.where.params, ["%budi%", "%budi%", "%budi%"]);

    queries = [];
    await GET(get("?q=" + encodeURIComponent("50%_x")));
    const e = queries.find((x) => x.kind === "list");
    assert.equal(e.where.params[0], "%50\\%\\_x%");
  });
});

test("filter digabung dengan AND", async () => {
  await signedIn(async () => {
    await GET(get("?status=failed&alertKind=offline&q=budi"));
    const q = queries.find((x) => x.kind === "list");
    assert.match(q.where.sql, /^\(.*\) and \(.*\) and \(.*\)$|and/i);
    assert.deepEqual(q.where.params, ["failed", "offline", "%budi%", "%budi%", "%budi%"]);
  });
});

test("?limit=10&offset=0 dan offset > 0 diteruskan; summary tidak ikut difilter", async () => {
  await signedIn(async () => {
    await GET(get("?limit=10&offset=0&status=sent"));
    assert.equal(queries.find((q) => q.kind === "list").limit, 10);
    assert.equal(queries.find((q) => q.kind === "list").offset, 0);
    assert.equal(queries.find((q) => q.kind === "summary").where, undefined);

    queries = [];
    await GET(get("?limit=10&offset=20"));
    assert.equal(queries.find((q) => q.kind === "list").offset, 20);
  });
});

test("query tidak valid -> 422 tanpa query DB", async () => {
  await signedIn(async () => {
    for (const qs of ["?status=delivered", "?limit=201", "?limit=0", "?offset=-1"]) {
      const res = await GET(get(qs));
      assert.equal(res.status, 422, qs);
      assert.equal((await res.json()).error.code, "VALIDATION_ERROR");
    }
    assert.equal(queries.length, 0);
  });
});
