import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { register } from "tsx/esm/api";

register();
const { outboundSourceIp } = await import("../src/services/outbound-source-ip.ts");
const { describeConnectionTroubleshoot: d } = await import("../src/components/dashboard/connection-error-notice.tsx");

function listen() {
  const { promise, resolve } = Promise.withResolvers();
  const server = net.createServer((s) => s.destroy());
  server.listen(0, "127.0.0.1", () => resolve(server));
  return promise;
}

test("outboundSourceIp mengembalikan alamat lokal yang dipakai untuk menyambung", async () => {
  const server = await listen();
  try {
    assert.equal(await outboundSourceIp("127.0.0.1", server.address().port), "127.0.0.1");
  } finally {
    server.close();
  }
});

test("outboundSourceIp null bila port tertutup (tidak ada alamat sumber untuk dilaporkan)", async () => {
  const server = await listen();
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  assert.equal(await outboundSourceIp("127.0.0.1", port), null);
});

test("CONNECTION_CLOSED mikrotik: judul, saran menambah (bukan mengganti) allow-list, command address=", () => {
  const r = d("CONNECTION_CLOSED", "mikrotik");
  assert.match(r.title, /menutup koneksi/i);
  assert.match(r.hint, /jangan mengganti/i);
  assert.match(r.command, /address=<DAFTAR-LAMA>/);
});
