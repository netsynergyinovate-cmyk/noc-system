import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { backendGet, resetBackendTicket, BackendError } = await import("../src/lib/dashboard/backend-api.ts");
const { loadLiveTrafficHistory } = await import("../src/lib/dashboard/history-live.ts");

const realFetch = globalThis.fetch;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ticket = (n) => ({ data: { token: `t${n}`, expiresAt: Math.floor(Date.now() / 1000) + 60, apiUrl: "http://backend:8080" } });

function install(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls);
  };
  return calls;
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
  resetBackendTicket();
});

test("tiket dipakai ulang antar permintaan dan jawaban dibuka dari {data}", async () => {
  let issued = 0;
  const calls = install((url) => (url === "/api/realtime/ticket" ? json(200, ticket(++issued)) : json(200, { data: { ok: 1 } })));
  assert.deepEqual(await backendGet("/api/v1/x", { a: 1 }), { ok: 1 });
  assert.deepEqual(await backendGet("/api/v1/x"), { ok: 1 });
  assert.equal(issued, 1, "tiket tidak diterbitkan ulang selagi masih berlaku");
  const api = calls.filter((c) => c.url.startsWith("http://backend:8080"));
  assert.equal(api[0].url, "http://backend:8080/api/v1/x?a=1");
  assert.equal(api[0].init.headers.Authorization, "Bearer t1");
});

test("401 sekali: tiket baru diminta lalu permintaan diulang; 401 kedua gagal", async () => {
  let issued = 0;
  let apiCalls = 0;
  install((url) => {
    if (url === "/api/realtime/ticket") return json(200, ticket(++issued));
    apiCalls += 1;
    return apiCalls === 1 ? json(401, {}) : json(200, { data: "ok" });
  });
  assert.equal(await backendGet("/api/v1/x"), "ok");
  assert.equal(issued, 2);

  resetBackendTicket();
  install((url) => (url === "/api/realtime/ticket" ? json(200, ticket(9)) : json(401, {})));
  await assert.rejects(backendGet("/api/v1/x"), (e) => e instanceof BackendError && e.status === 401);
});

test("galat tiket dan jawaban tak berbentuk ditolak dengan BackendError", async () => {
  install(() => json(503, {}));
  await assert.rejects(backendGet("/api/v1/x"), (e) => e instanceof BackendError && e.status === 503);
  resetBackendTicket();
  install((url) => (url === "/api/realtime/ticket" ? json(200, ticket(1)) : json(200, { bukan: "data" })));
  await assert.rejects(backendGet("/api/v1/x"), (e) => e instanceof BackendError && e.status === 502);
});

test("loadLiveTrafficHistory memetakan jawaban Go; arsip kosong menjadi deret kosong tanpa insiden tiruan", async () => {
  install((url) => {
    if (url === "/api/realtime/ticket") return json(200, ticket(1));
    assert.match(url, /\/api\/v1\/traffic\/history\?range=1h$/);
    return json(200, { data: { from: 100, to: 200, step: 10, times: [100, 110], rx: [1.5, 2], tx: [0.5, 0.25] } });
  });
  const h = await loadLiveTrafficHistory("1h");
  assert.deepEqual([h.range, h.from, h.to, h.stepSeconds], ["1h", 100, 200, 10]);
  assert.deepEqual(h.series, { times: [100, 110], rx: [1.5, 2], tx: [0.5, 0.25] });
  assert.deepEqual(h.incidents, []);

  install((url) => (url === "/api/realtime/ticket" ? json(200, ticket(2)) : json(200, { data: { from: 1, to: 2, step: 60, times: [], rx: [], tx: [] } })));
  resetBackendTicket();
  const empty = await loadLiveTrafficHistory("6h");
  assert.deepEqual(empty.series, { times: [], rx: [], tx: [] });
});
