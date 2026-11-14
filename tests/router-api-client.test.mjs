import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { register } from "tsx/esm/api";

register();
const { encodeSentence, SentenceParser, withRouterOsApi, RouterOsApiError } =
  await import("../src/lib/mikrotik/api-client.ts");

test("encodeSentence/SentenceParser round-trip di batas panjang kata, termasuk chunk terpotong", () => {
  // Kata kosong = terminator kalimat di protokol, jadi panjang 0 tidak bisa menjadi kata.
  for (const n of [1, 127, 128, 16383, 16384, 2097152]) {
    const words = ["/x", "a".repeat(n), "tail"];
    const buf = encodeSentence(words);
    const p = new SentenceParser();
    const got = [];
    for (let i = 0; i < buf.length; i += 5000)
      got.push(...p.push(buf.subarray(i, i + 5000)));
    assert.deepEqual(got, [words], `n=${n}`);
  }
  const p = new SentenceParser();
  const two = Buffer.concat([
    encodeSentence(["!done"]),
    encodeSentence(["!re", "=a=1"]),
  ]);
  assert.deepEqual(p.push(two.subarray(0, 9)), [["!done"]]);
  assert.deepEqual(p.push(two.subarray(9)), [["!re", "=a=1"]]);
});

function fakeRouter(handler) {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      const p = new SentenceParser();
      sock.on("data", (c) => {
        for (const s of p.push(c)) handler(sock, s);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}
const stop = (server) => {
  server.close();
  server.closeAllConnections?.();
};
const tagOf = (s) => s.find((w) => w.startsWith(".tag="));

test("withRouterOsApi: login v7 + run mengembalikan baris !re dan menutup soket", async () => {
  let closed = false;
  const server = await fakeRouter((sock, s) => {
    sock.on("close", () => (closed = true));
    if (s[0] === "/login") sock.write(encodeSentence(["!done", tagOf(s)]));
    else {
      sock.write(
        encodeSentence(["!re", "=version=7.15", "=board-name=hAP", tagOf(s)]),
      );
      sock.write(encodeSentence(["!done", tagOf(s)]));
    }
  });
  const { port } = server.address();
  const rows = await withRouterOsApi(
    { host: "127.0.0.1", port, username: "a", password: "b" },
    (api) => api.run(["/system/resource/print"]),
  );
  assert.deepEqual(rows, [{ version: "7.15", "board-name": "hAP" }]);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(closed, true);
  stop(server);
});

test("login !trap -> AUTH_FAILED; tanpa jawaban -> TIMEOUT", async () => {
  const bad = await fakeRouter((sock, s) => {
    sock.write(encodeSentence(["!trap", "=message=cannot log in", tagOf(s)]));
    sock.write(encodeSentence(["!done", tagOf(s)]));
  });
  await assert.rejects(
    withRouterOsApi(
      {
        host: "127.0.0.1",
        port: bad.address().port,
        username: "a",
        password: "b",
      },
      async () => 1,
    ),
    (e) =>
      e instanceof RouterOsApiError &&
      e.code === "AUTH_FAILED" &&
      e.message === "cannot log in",
  );
  stop(bad);
  const mute = await fakeRouter(() => {});
  await assert.rejects(
    withRouterOsApi(
      {
        host: "127.0.0.1",
        port: mute.address().port,
        username: "a",
        password: "b",
        timeoutMs: 200,
      },
      async () => 1,
    ),
    (e) => e instanceof RouterOsApiError && e.code === "TIMEOUT",
  );
  stop(mute);
});

test("!trap lalu soket ditutup tanpa !done -> AUTH_FAILED dengan pesan trap; kata kosong ditolak", async () => {
  const srv = await fakeRouter((sock, s) => {
    sock.write(
      encodeSentence([
        "!trap",
        "=message=invalid user name or password",
        tagOf(s),
      ]),
    );
    sock.end();
  });
  await assert.rejects(
    withRouterOsApi(
      {
        host: "127.0.0.1",
        port: srv.address().port,
        username: "a",
        password: "b",
      },
      async () => 1,
    ),
    (e) =>
      e instanceof RouterOsApiError &&
      e.code === "AUTH_FAILED" &&
      /invalid user/.test(e.message),
  );
  stop(srv);
  assert.throws(
    () => encodeSentence(["/x", ""]),
    (e) => e.code === "PROTOCOL",
  );
});

test("router memutus koneksi setelah tersambung -> CONNECTION_RESET, bukan 'read ECONNRESET' mentah", async () => {
  const server = net.createServer((sock) => sock.resetAndDestroy());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    await assert.rejects(
      withRouterOsApi(
        { host: "127.0.0.1", port, username: "u", password: "p" },
        async () => {},
      ),
      (e) =>
        e instanceof RouterOsApiError &&
        e.code === "CONNECTION_RESET" &&
        /memutus koneksi API/.test(e.message) &&
        !/^read ECONNRESET$/.test(e.message),
    );
  } finally {
    server.close();
  }
});
