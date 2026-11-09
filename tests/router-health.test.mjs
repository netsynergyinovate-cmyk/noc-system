import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const h = await import("../src/lib/dashboard/router-health.ts");
const { alertKindLabel } = await import("../src/lib/dashboard/incidents.ts");

test("galat 'EOF' (router menutup koneksi) dikenali sebagai IP server tidak diizinkan, dengan perintah siap tempel", () => {
  for (const e of [
    "hubungi router: EOF",
    "read tcp: connection reset by peer",
    "write: broken pipe",
    // Windows: backend Go di PC/server Windows.
    "hubungi router: read tcp 192.168.0.182:54991->103.167.70.136:80: wsarecv: An existing connection was forcibly closed by the remote host.",
  ]) {
    const d = h.diagnoseUnreachable(e, {
      sourceIp: "203.0.113.5",
      protocol: "rest",
    });
    assert.equal(d.cause, "closed", e);
    assert.match(d.hint, /203\.0\.113\.5/);
    assert.ok(
      d.command.includes("/ip service set www address=203.0.113.5/32"),
      d.command,
    );
    assert.doesNotMatch(d.command, /DAFTAR-LAMA|<IP-SERVER>|:foreach|:local/);
  }
});

test("perintah allow-list menambah ke daftar lama (tidak menimpa) dan memakai layanan api bila perlu", () => {
  const d = h.diagnoseUnreachable("hubungi router: EOF", {
    sourceIp: "203.0.113.5",
    protocol: "api",
  });
  assert.ok(
    d.command.includes("/ip service set api address=203.0.113.5/32"),
    d.command,
  );
  // Tanpa IP sumber: jangan mengarang placeholder, arahkan membaca daftar.
  const noIp = h.diagnoseUnreachable("hubungi router: EOF");
  assert.equal(noIp.command, '/ip service print where name~"www"');
  assert.doesNotMatch(noIp.command, /DAFTAR-LAMA|<IP-SERVER>/);
});

test("penyebab lain dipetakan ke sebab yang tepat", () => {
  const c = (e) => h.diagnoseUnreachable(e).cause;
  assert.equal(
    c("router menolak login (HTTP 401): periksa username dan kata sandi"),
    "auth",
  );
  assert.equal(c("router menjawab HTTP 403"), "auth");
  assert.equal(
    c("dial tcp 10.0.0.1:80: connect: connection refused"),
    "refused",
  );
  assert.equal(c("router tidak menjawab dalam 9s"), "timeout");
  assert.equal(c("context deadline exceeded"), "timeout");
  assert.equal(c("dial tcp: lookup router.example: no such host"), "dns");
  assert.equal(c("sesuatu yang aneh"), "unknown");
  assert.equal(c(""), "unknown");
  // Login ditolak tidak boleh salah dibaca sebagai "koneksi ditutup".
  assert.equal(c("hubungi router: EOF"), "closed");
  assert.equal(
    c(
      "hubungi router: read tcp 192.168.0.182:54991->103.167.70.136:80: wsarecv: An existing connection was forcibly closed by the remote host.",
    ),
    "closed",
  );
});

test("hanya router aktif yang tidak terjangkau yang ditandai", () => {
  const r = (o) => ({
    routerId: "r",
    name: "R",
    host: "h",
    active: true,
    reachable: true,
    failures: 0,
    lastError: "",
    lastErrorAt: null,
    lastOkAt: null,
    ...o,
  });
  const out = h.unreachableRouters([
    r({ routerId: "a" }),
    r({ routerId: "b", reachable: false }),
    r({ routerId: "c", reachable: false, active: false }),
  ]);
  assert.deepEqual(
    out.map((x) => x.routerId),
    ["b"],
  );
});

test("keterangan pembacaan terakhir: relatif dan jujur bila belum pernah", () => {
  const now = 1_791_970_000;
  assert.match(h.describeLastOk(now - 30, now), /30 detik lalu/);
  assert.match(h.describeLastOk(now - 23 * 60, now), /23 menit lalu/);
  assert.match(
    h.describeLastOk(now - 3 * 3600 - 120, now),
    /3 jam 2 menit lalu/,
  );
  assert.match(h.describeLastOk(now - 2 * 86400, now), /2 hari lalu/);
  assert.match(h.describeLastOk(null, now), /Belum ada pembacaan/);
  assert.match(h.describeLastOk(now + 50, now), /0 detik lalu/); // jam miring tidak jadi negatif
});

test("alert 'offline' tanpa pelanggan berlabel router, dengan pelanggan tetap pelanggan", () => {
  assert.equal(
    alertKindLabel({ kind: "offline", customerId: null }),
    "Router tidak terjangkau",
  );
  assert.notEqual(
    alertKindLabel({ kind: "offline", customerId: "c1" }),
    "Router tidak terjangkau",
  );
  assert.notEqual(
    alertKindLabel({ kind: "cpu", customerId: null }),
    "Router tidak terjangkau",
  );
});
