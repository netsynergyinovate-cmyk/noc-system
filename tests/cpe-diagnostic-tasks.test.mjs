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
const { cpeTasks, customers, auditLog } = await import("../src/db/schema/index.ts");
const {
  createDiagnosticTaskSchema,
  listCpeTasksParamsSchema,
} = await import("../src/validators/cpe.ts");
const {
  enqueueDiagnosticTask,
  listCpeDiagnosticTasks,
} = await import("../src/services/cpe.service.ts");
const {
  GET: getTasksRoute,
  POST: postTasksRoute,
} = await import("../src/app/api/cpe/tasks/route.ts");
const {
  GET: getCustomerTasksRoute,
} = await import("../src/app/api/customers/[id]/cpe/tasks/route.ts");

const custId = "550e8400-e29b-41d4-a716-446655440000";
const taskId = "660e8400-e29b-41d4-a716-446655440000";

let role = "admin";
auth.api.getSession = async () => (role === "anon" ? null : { user: { id: "u1" }, session: {} });
auth.api.userHasPermission = async () => ({ success: role === "admin" });

test("validator: createDiagnosticTaskSchema validasi input", () => {
  const valid = createDiagnosticTaskSchema.safeParse({
    customerId: custId,
    action: "ping_test",
    parameters: { host: "8.8.8.8" },
  });
  assert.ok(valid.success);

  const invalidAction = createDiagnosticTaskSchema.safeParse({
    customerId: custId,
    action: "format_c",
  });
  assert.equal(invalidAction.success, false);

  const invalidCustId = createDiagnosticTaskSchema.safeParse({
    customerId: "not-uuid",
    action: "ping_test",
  });
  assert.equal(invalidCustId.success, false);
});

test("validator: listCpeTasksParamsSchema validasi & default limit", () => {
  const parsed = listCpeTasksParamsSchema.parse({});
  assert.equal(parsed.limit, 50);
  assert.equal(parsed.offset, 0);

  const filtered = listCpeTasksParamsSchema.parse({
    customerId: custId,
    status: "success",
    limit: "10",
  });
  assert.equal(filtered.customerId, custId);
  assert.equal(filtered.status, "success");
  assert.equal(filtered.limit, 10);
});

// Mock database
let mockTasks = [];
let mockCustomers = [
  { id: custId, name: "Budi Santoso", pppoeUsername: "budi@isp" },
];
let mockAudits = [];

db.transaction = async (fn) => {
  const tx = {
    insert(table) {
      return {
        values(val) {
          if (table === cpeTasks) {
            const row = {
              id: taskId,
              customerId: val.customerId,
              action: val.action,
              payload: val.payload,
              createdBy: val.createdBy,
              status: val.status,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            mockTasks.push(row);
            return {
              returning: () => Promise.resolve([row]),
            };
          }
          if (table === auditLog) {
            mockAudits.push(val);
            return Promise.resolve();
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
  let conditions = [];
  const chain = {
    from(t) {
      table = t;
      return chain;
    },
    leftJoin() {
      return chain;
    },
    where(w) {
      conditions.push(w);
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
        return resolve([{ total: mockTasks.length }]);
      }
      if (table === customers) {
        return resolve(mockCustomers);
      }
      if (table === cpeTasks) {
        return resolve(mockTasks);
      }
      return resolve([]);
    },
  };
  return chain;
};

db.update = (table) => {
  let setVals = {};
  const chain = {
    set(v) {
      setVals = v;
      return chain;
    },
    where() {
      return chain;
    },
    then(resolve) {
      if (table === cpeTasks) {
        const t = mockTasks.find((x) => x.id === taskId);
        if (t) Object.assign(t, setVals);
      }
      return resolve([{ id: taskId }]);
    },
  };
  return chain;
};

test("service: enqueueDiagnosticTask berhasil menjalankan task & mencatat audit", async () => {
  mockTasks = [];
  mockAudits = [];
  const task = await enqueueDiagnosticTask(
    {
      customerId: custId,
      action: "ping_test",
      parameters: { host: "1.1.1.1" },
    },
    "u1",
  );

  assert.ok(task);
  assert.equal(task.id, taskId);
  assert.equal(task.customerId, custId);
  assert.equal(task.action, "ping_test");
  assert.equal(task.status, "success");
  assert.ok(task.payload.resultSummary);
  assert.equal(mockAudits.length, 1);
  assert.equal(mockAudits[0].action, "cpe_diagnostic_ping_test");
});

test("service: listCpeDiagnosticTasks mengembalikan riwayat", async () => {
  const res = await listCpeDiagnosticTasks({ limit: 10, offset: 0 });
  assert.ok(Array.isArray(res.items));
  assert.equal(res.total, 1);
  assert.equal(res.items[0].id, taskId);
});

test("endpoint: POST /api/cpe/tasks auth & permission check", async () => {
  role = "anon";
  const req401 = new Request("http://localhost:3101/api/cpe/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerId: custId, action: "reboot_device" }),
  });
  const res401 = await postTasksRoute(req401);
  assert.equal(res401.status, 401);

  role = "user";
  const req403 = new Request("http://localhost:3101/api/cpe/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerId: custId, action: "reboot_device" }),
  });
  const res403 = await postTasksRoute(req403);
  assert.equal(res403.status, 403);
});

test("endpoint: POST & GET /api/cpe/tasks sukses", async () => {
  role = "admin";
  const postReq = new Request("http://localhost:3101/api/cpe/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "http://localhost:3101" },
    body: JSON.stringify({ customerId: custId, action: "check_optical" }),
  });
  const postRes = await postTasksRoute(postReq);
  assert.equal(postRes.status, 201);
  const postBody = await postRes.json();
  assert.ok(postBody.data);
  assert.equal(postBody.data.action, "check_optical");

  const getReq = new Request("http://localhost:3101/api/cpe/tasks?limit=5");
  const getRes = await getTasksRoute(getReq);
  assert.equal(getRes.status, 200);
  const getBody = await getRes.json();
  assert.ok(Array.isArray(getBody.data.items));
});

test("endpoint: GET /api/customers/[id]/cpe/tasks mengembalikan riwayat per pelanggan", async () => {
  role = "admin";
  const getReq = new Request(`http://localhost:3101/api/customers/${custId}/cpe/tasks`);
  const getRes = await getCustomerTasksRoute(getReq, {
    params: Promise.resolve({ id: custId }),
  });
  assert.equal(getRes.status, 200);
  const getBody = await getRes.json();
  assert.ok(Array.isArray(getBody.data));
});
