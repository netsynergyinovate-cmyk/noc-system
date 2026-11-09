import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { pingTcp } from "../src/lib/olt/tcp-ping.ts";

test("pingTcp: sukses mengukur latensi pada server TCP yang mendengarkan", async () => {
  const server = net.createServer((sock) => sock.end());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const res = await pingTcp("127.0.0.1", port, 2000);
  assert.equal(res.ok, true);
  assert.ok(typeof res.latencyMs === "number" && res.latencyMs >= 0);

  await new Promise((r) => server.close(r));
});

test("pingTcp: gagal dengan status ok=false pada port tertutup", async () => {
  // Buka lalu segera tutup server untuk mendapatkan port bebas yang pasti tertutup
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));

  const res = await pingTcp("127.0.0.1", port, 500);
  assert.equal(res.ok, false);
  assert.ok(typeof res.error === "string");
});
