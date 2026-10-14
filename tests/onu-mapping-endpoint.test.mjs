import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DASHBOARD_DATA = "demo";
process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL = "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();
const { auth } = await import("../src/lib/auth.ts");
const { db } = await import("../src/db/index.ts");
const { oltOnus, customers, auditLog } = await import("../src/db/schema/index.ts");
const {
  mapOnuSchema,
  parseListOnusParams,
  ONU_MAX_LIMIT,
  ONU_DEFAULT_LIMIT,
} = await import("../src/validators/devices.ts");
const {
  mapOnuToCustomer,
  getOnu,
  getCustomerOnu,
  listOnus,
} = await import("../src/services/devices.service.ts");
const {
  POST: postMap,
  PUT: putMap,
  GET: getMap,
  DELETE: deleteMap,
} = await import("../src/app/api/onus/[id]/map/route.ts");
const { GET: getOnuRoute } = await import("../src/app/api/onus/[id]/route.ts");
const { GET: getCustomerOnuRoute } = await import("../src/app/api/customers/[id]/onu/route.ts");

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const custId = "223e4567-e89b-42d3-a456-426614174000";
const onuId = "323e4567-e89b-42d3-a456-426614174000";

let role = "admin";
auth.api.getSession = async () => (role === "anon" ? null : { user: { id: "u1" }, session: {} });
auth.api.userHasPermission = async () => ({ success: role === "admin" });

test("body mapping: uuid atau null diterima", () => {
  assert.ok(mapOnuSchema.safeParse({ customerId: uuid }).success);
  assert.ok(mapOnuSchema.safeParse({ customerId: null }).success);
});

test("body mapping: string acak, tipe salah, field hilang/asing ditolak", () => {
  for (const bad of [
    { customerId: "abc" },
    { customerId: "" },
    { customerId: 1 },
    { customerId: undefined },
    {},
    { customerId: uuid, extra: 1 },
    null,
  ]) {
    assert.equal(mapOnuSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test("filter status hanya online/offline", () => {
  assert.equal(parseListOnusParams(new URLSearchParams("status=online")).status, "online");
  assert.equal(parseListOnusParams(new URLSearchParams("status=offline")).status, "offline");
  assert.equal(parseListOnusParams(new URLSearchParams("status=x")).status, undefined);
  assert.equal(parseListOnusParams(new URLSearchParams()).status, undefined);
});

test("filter oltId, customerId, isMapped, isWeak, q", () => {
  const p = parseListOnusParams(
    new URLSearchParams(`oltId=${uuid}&customerId=${custId}&isMapped=true&isWeak=true&q=%20budi%20`),
  );
  assert.equal(p.oltId, uuid);
  assert.equal(p.customerId, custId);
  assert.equal(p.isMapped, true);
  assert.equal(p.isWeak, true);
  assert.equal(p.q, "budi");

  const p2 = parseListOnusParams(new URLSearchParams("mapped=false"));
  assert.equal(p2.isMapped, false);

  const b = parseListOnusParams(new URLSearchParams("oltId=bukan-uuid&customerId=bukan-uuid&isMapped=maybe&isWeak=maybe&q=%20"));
  assert.equal(b.oltId, undefined);
  assert.equal(b.customerId, undefined);
  assert.equal(b.isMapped, undefined);
  assert.equal(b.isWeak, undefined);
  assert.equal(b.q, undefined);
});

test("limit/offset dijepit", () => {
  const f = (s) => parseListOnusParams(new URLSearchParams(s));
  assert.equal(f("").limit, ONU_DEFAULT_LIMIT);
  assert.equal(f("").offset, 0);
  assert.equal(f("limit=0").limit, 1);
  assert.equal(f("limit=99999").limit, ONU_MAX_LIMIT);
  assert.equal(f("limit=-5").limit, ONU_DEFAULT_LIMIT);
  assert.equal(f("limit=abc").limit, ONU_DEFAULT_LIMIT);
  assert.equal(f("limit=10").limit, 10);
  assert.equal(f("offset=-3").offset, 0);
  assert.equal(f("offset=20").offset, 20);
});

// Mock database transactions & queries
let dbState = {
  onus: new Map(),
  customers: new Map(),
  auditLogs: [],
};

function resetDb() {
  role = "admin";
  dbState = {
    onus: new Map([
      [
        onuId,
        {
          id: onuId,
          oltId: uuid,
          oltName: "OLT Utama",
          ponIndex: 1,
          onuIndex: 1,
          description: "ONU-01",
          serialNumber: "HSGQ0001",
          customerId: null,
          customerName: null,
          pppoeUsername: null,
          rxPower: -19.5,
          txPower: 2.1,
          attenuation: 21.6,
          status: "online",
          capturedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ],
    ]),
    customers: new Map([
      [
        custId,
        {
          id: custId,
          name: "Budi Santoso",
          pppoeUsername: "budi@isp",
          opticalPower: null,
        },
      ],
    ]),
    auditLogs: [],
  };
}

db.transaction = async (fn) => {
  let selectCount = 0;
  const tx = {
    select(cols) {
      let table;
      const chain = {
        from(t) {
          table = t;
          return chain;
        },
        where() {
          return chain;
        },
        limit() {
          return chain;
        },
        then(resolve) {
          selectCount++;
          if (table === oltOnus) {
            // First select in mapOnuToCustomer is onuRow
            if (cols && "prevCustomerId" in cols) {
              const onu = dbState.onus.get(onuId);
              return resolve(onu ? [{ id: onu.id, rxPower: onu.rxPower, prevCustomerId: onu.customerId }] : []);
            }
            // Second select is taken check: any other ONU mapped to customerId
            const taken = Array.from(dbState.onus.values()).find(
              (o) => o.id !== onuId && o.customerId === custId,
            );
            return resolve(taken ? [{ id: taken.id }] : []);
          }
          if (table === customers) {
            const c = dbState.customers.get(custId);
            return resolve(c ? [{ id: c.id }] : []);
          }
          return resolve([]);
        },
      };
      return chain;
    },
    update(table) {
      let values = {};
      const chain = {
        set(v) {
          values = v;
          return chain;
        },
        where() {
          return chain;
        },
        returning() {
          return chain;
        },
        then(resolve) {
          if (table === oltOnus) {
            const onu = dbState.onus.get(onuId);
            if (onu) {
              onu.customerId = values.customerId;
              if (values.customerId) {
                const c = dbState.customers.get(values.customerId);
                onu.customerName = c?.name ?? null;
                onu.pppoeUsername = c?.pppoeUsername ?? null;
              } else {
                onu.customerName = null;
                onu.pppoeUsername = null;
              }
              return resolve([{ id: onuId }]);
            }
            return resolve([]);
          }
          if (table === customers) {
            const c = dbState.customers.get(custId);
            if (c) Object.assign(c, values);
            return resolve([{ id: custId }]);
          }
          return resolve([]);
        },
      };
      return chain;
    },
    insert(table) {
      return {
        values(val) {
          if (table === auditLog) {
            dbState.auditLogs.push(val);
          }
          return Promise.resolve();
        },
      };
    },
  };
  return fn(tx);
};

db.select = (cols) => {
  let table;
  const chain = {
    from(t) {
      table = t;
      return chain;
    },
    leftJoin() {
      return chain;
    },
    innerJoin() {
      return chain;
    },
    where() {
      return chain;
    },
    orderBy() {
      return chain;
    },
    limit() {
      return chain;
    },
    offset() {
      return chain;
    },
    then(resolve) {
      if (cols && "total" in cols) {
        return resolve([{ total: dbState.onus.size }]);
      }
      if (table === oltOnus) {
        const items = Array.from(dbState.onus.values()).map((o) => ({
          ...o,
          isWeak: (o.rxPower ?? 0) < -27,
        }));
        return resolve(items);
      }
      return resolve([]);
    },
  };
  return chain;
};

test("service: mapOnuToCustomer sukses memetakan & audit tercatat", async () => {
  resetDb();
  const res = await mapOnuToCustomer(onuId, custId, "user-1");
  assert.ok(res);
  assert.equal(res.id, onuId);
  assert.equal(res.customerId, custId);
  assert.equal(res.customerName, "Budi Santoso");
  assert.equal(res.trouble.isTroubled, false);
  assert.equal(dbState.customers.get(custId).opticalPower, -19.5);
  assert.equal(dbState.auditLogs.length, 1);
  assert.equal(dbState.auditLogs[0].action, "onu-mapped");
});

test("service: mapOnuToCustomer null melepas pemetaan & audit onu-unmapped", async () => {
  resetDb();
  dbState.onus.get(onuId).customerId = custId;
  const res = await mapOnuToCustomer(onuId, null, "user-1");
  assert.ok(res);
  assert.equal(res.customerId, null);
  assert.equal(dbState.auditLogs.length, 1);
  assert.equal(dbState.auditLogs[0].action, "onu-unmapped");
});

test("endpoint: POST /api/onus/[id]/map auth & perm check", async () => {
  resetDb();
  role = "anon";
  const req401 = new Request(`http://localhost:3101/api/onus/${onuId}/map`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost:3101" },
    body: JSON.stringify({ customerId: custId }),
  });
  const res401 = await postMap(req401, { params: Promise.resolve({ id: onuId }) });
  assert.equal(res401.status, 401);

  role = "user";
  const req403 = new Request(`http://localhost:3101/api/onus/${onuId}/map`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost:3101" },
    body: JSON.stringify({ customerId: custId }),
  });
  const res403 = await postMap(req403, { params: Promise.resolve({ id: onuId }) });
  assert.equal(res403.status, 403);
});

test("endpoint: POST / PUT / GET / DELETE /api/onus/[id]/map sukses", async () => {
  resetDb();
  role = "admin";

  // POST map
  const postReq = new Request(`http://localhost:3101/api/onus/${onuId}/map`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost:3101" },
    body: JSON.stringify({ customerId: custId }),
  });
  const postRes = await postMap(postReq, { params: Promise.resolve({ id: onuId }) });
  assert.equal(postRes.status, 200);
  const postBody = await postRes.json();
  assert.equal(postBody.data.customerId, custId);

  // GET map status
  const getReq = new Request(`http://localhost:3101/api/onus/${onuId}/map`);
  const getRes = await getMap(getReq, { params: Promise.resolve({ id: onuId }) });
  assert.equal(getRes.status, 200);
  const getBody = await getRes.json();
  assert.equal(getBody.data.customerId, custId);
  assert.equal(getBody.data.onuId, onuId);

  // DELETE unmap
  const delReq = new Request(`http://localhost:3101/api/onus/${onuId}/map`, {
    method: "DELETE",
    headers: { origin: "http://localhost:3101" },
  });
  const delRes = await deleteMap(delReq, { params: Promise.resolve({ id: onuId }) });
  assert.equal(delRes.status, 200);
  const delBody = await delRes.json();
  assert.equal(delBody.data.customerId, null);
});

test("endpoint: GET /api/onus/[id] & GET /api/customers/[id]/onu", async () => {
  resetDb();
  role = "admin";

  // GET onu
  const onuReq = new Request(`http://localhost:3101/api/onus/${onuId}`);
  const onuRes = await getOnuRoute(onuReq, { params: Promise.resolve({ id: onuId }) });
  assert.equal(onuRes.status, 200);
  const onuBody = await onuRes.json();
  assert.equal(onuBody.data.id, onuId);

  // GET customer onu
  const custReq = new Request(`http://localhost:3101/api/customers/${custId}/onu`);
  const custRes = await getCustomerOnuRoute(custReq, { params: Promise.resolve({ id: custId }) });
  assert.equal(custRes.status, 200);
  const custBody = await custRes.json();
  assert.ok("data" in custBody);
});
