import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { register } from "tsx/esm/api";

register();
const { testHsgqTelnetLogin, parseTelnetHost, stripTelnet } = await import("../src/lib/olt/hsgq-telnet.ts");

// OLT tiruan: IAC, banner dengan kata "fail" (tabel login gagal), prompt login, prompt CLI.
function fakeOlt({ user, pass, silent = false }) {
  const server = net.createServer((c) => {
    if (silent) return; // tidak pernah mengirim apa pun
    c.write(Buffer.from([255, 251, 1, 255, 253, 31]));
    c.write("\x1b[H\x1b[J\r\n  HSGQ-XE08ID EPON OLT Operating System\r\n\r\nusername: ");
    let stage = "user";
    let buf = "";
    let tries = 0;
    c.on("data", (d) => {
      const clean = Array.from(d).filter((b) => b !== 255).map((b) => String.fromCharCode(b)).join("");
      buf += clean.replace(/[\xfb-\xfe]./g, "");
      const i = buf.indexOf("\n");
      if (i < 0) return;
      const line = buf.slice(0, i).replace(/\r/g, "").trim();
      buf = buf.slice(i + 1);
      if (stage === "user") {
        stage = "pass";
        c.write("\r\npassword: ");
        c.__u = line;
      } else if (stage === "pass") {
        if (c.__u === user && line === pass) {
          stage = "shell";
          c.write("\r\nAll user fail login information:\r\n Telnet 1.2.3.4 2026/10/14 7\r\n\r\nOLT-X>");
        } else if (++tries >= 3) {
          c.end();
        } else {
          stage = "user";
          c.write("\r\nlogin incorrect\r\nusername: ");
        }
      } else if (line === "exit") {
        c.end();
      } else {
        c.write(line + "\r\nOLT-X>");
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const addr = (s) => `127.0.0.1:${s.address().port}`;

test("login benar: sukses, banner dikenali, kata 'fail' di banner bukan kegagalan", async () => {
  const s = await fakeOlt({ user: "NOCApp", pass: "rahasia" });
  try {
    const r = await testHsgqTelnetLogin({ host: addr(s), username: "NOCApp", password: "rahasia", timeoutMs: 3000 });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.code, "OK");
    assert.match(r.banner, /HSGQ-XE08ID EPON OLT Operating System/);
  } finally {
    s.close();
  }
});

test("kata sandi salah: AUTH_FAILED dan kata sandi tidak muncul di pesan", async () => {
  const s = await fakeOlt({ user: "NOCApp", pass: "rahasia" });
  try {
    const r = await testHsgqTelnetLogin({ host: addr(s), username: "NOCApp", password: "salah-123", timeoutMs: 3000 });
    assert.equal(r.ok, false);
    assert.equal(r.code, "AUTH_FAILED");
    assert.ok(!r.message.includes("salah-123") && !r.message.includes("rahasia"));
  } finally {
    s.close();
  }
});

test("port tertutup, host tak dikenal, dan server bisu dipetakan ke kode yang jelas", async () => {
  const refused = await testHsgqTelnetLogin({ host: "127.0.0.1:1", username: "u", password: "p", timeoutMs: 2000 });
  assert.deepEqual([refused.ok, refused.code], [false, "CONNECTION_REFUSED"]);

  const silent = await fakeOlt({ user: "u", pass: "p", silent: true });
  try {
    const t = await testHsgqTelnetLogin({ host: addr(silent), username: "u", password: "p", timeoutMs: 600 });
    assert.deepEqual([t.ok, t.code], [false, "TIMEOUT"]);
    assert.match(t.message, /port telnet/);
  } finally {
    silent.close();
  }
});

test("alamat tidak valid ditolak tanpa koneksi", async () => {
  for (const host of ["http://10.0.0.1", "10.0.0.1/x", "", "a b", "10.0.0.1:99999", "u@10.0.0.1"]) {
    const r = await testHsgqTelnetLogin({ host, username: "u", password: "p" });
    assert.equal(r.ok, false, host);
    assert.equal(r.code, "PROTOCOL_ERROR", host);
  }
  assert.deepEqual(parseTelnetHost("10.0.0.1"), { host: "10.0.0.1", port: 23 });
  assert.deepEqual(parseTelnetHost("Olt.Example.com:2323"), { host: "olt.example.com", port: 2323 });
});

test("negosiasi telnet dibalas penolakan dan dibuang dari teks", () => {
  const { text, reply } = stripTelnet(Buffer.from([255, 251, 1, 72, 105, 255, 253, 31, 255, 250, 24, 1, 255, 240, 33]));
  assert.equal(text, "Hi!");
  assert.deepEqual([...reply], [255, 254, 1, 255, 252, 31]);
});
