import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { mapMikrotikError } = await import("../src/lib/mikrotik/errors.ts");

// Router RouterOS yang menolak IP sumber (address= pada /ip service) menerima TCP lalu memutusnya.
// fetch (undici) melaporkannya sebagai "fetch failed" dengan cause UND_ERR_SOCKET / ECONNRESET.
test("koneksi diputus setelah TCP tersambung dipetakan ke CONNECTION_CLOSED, bukan galat jaringan umum", () => {
  for (const cause of [{ code: "UND_ERR_SOCKET" }, { code: "ECONNRESET" }, { code: "UND_ERR_SOCKET", message: "other side closed" }]) {
    const m = mapMikrotikError(Object.assign(new Error("fetch failed"), { cause }), { host: "10.20.30.1", port: 8081 });
    assert.equal(m.code, "CONNECTION_CLOSED", JSON.stringify(cause));
    assert.equal(m.retryable, true);
    assert.match(m.message, /10\.20\.30\.1:8081/);
    // Petunjuk harus menyuruh MENAMBAH ke daftar yang ada, bukan menimpa allow-list.
    assert.match(m.hint, /jangan mengganti/i);
    assert.match(m.command ?? "", /address=<DAFTAR-LAMA>/);
  }
});

test("penolakan port dan timeout tidak ikut terpetakan sebagai CONNECTION_CLOSED", () => {
  const refused = mapMikrotikError(Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }));
  assert.equal(refused.code, "CONNECTION_REFUSED");
  const timeout = mapMikrotikError(Object.assign(new Error("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }));
  assert.equal(timeout.code, "TIMEOUT");
});

test("port Winbox 8291 ditolak sebagai WRONG_PORT tanpa koneksi (bukan 'koneksi ditolak' yang menyesatkan)", async () => {
  const { MikrotikRestClient } = await import("../src/lib/mikrotik/client.ts");
  const res = await new MikrotikRestClient({
    host: "10.0.0.5", port: 8291, username: "a", password: "b", mode: "real", timeoutMs: 500,
  }).testConnection();
  assert.deepEqual([res.ok, res.code], [false, "WRONG_PORT"]);
  assert.match(res.message, /Winbox/);
});
