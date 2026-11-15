import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const h = await import("../src/lib/dashboard/router-health.ts");
const { alertKindLabel } = await import("../src/lib/dashboard/incidents.ts");

test("galat 'EOF'/reset dikenali sebagai router memutus sambungan, dengan langkah baca IP lalu TAMBAH ke daftar", () => {
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
      host: "103.167.70.136",
    });
    assert.equal(d.cause, "closed", e);
    assert.match(d.hint, /203\.0\.113\.5/);
    assert.match(d.hint, /max-sessions/);
    // Menambah ke daftar lama lewat ekspresi array RouterOS, tidak pernah mengganti.
    assert.equal(
      d.command,
      '/ip service set www address=([/ip service get www address],"203.0.113.5/32")',
    );
    assert.equal(d.steps.length, 3);
    assert.ok(
      d.steps[0].command.includes('dst-address~"103.167.70.136:80\\$"'),
      d.steps[0].command,
    );
    assert.equal(d.steps[1].allowIp, "203.0.113.5");
    assert.equal(
      d.steps[2].command,
      "/ip service disable www\n/ip service enable www",
    );
    assert.doesNotMatch(d.command, /DAFTAR-LAMA|<IP-SERVER>|:foreach|:local/);
  }
});

test("tanpa IP perkiraan (container/di balik router): arahkan baca IP di router, jangan mengarang IP", () => {
  const d = h.diagnoseUnreachable("hubungi router: EOF", {
    protocol: "api",
    host: "103.167.70.136:8728",
  });
  assert.equal(
    d.command,
    '/ip firewall connection print where protocol=tcp and dst-address~"103.167.70.136:8728\\$"',
  );
  assert.equal(d.steps[1].allowIp, "");
  assert.match(d.hint, /tidak bisa mengetahui IP/);
  const noHost = h.diagnoseUnreachable("hubungi router: EOF");
  assert.equal(noHost.command, '/ip service print where name~"www"');
});

test("appendAllowListCommand menolak masukan yang bukan IPv4 (tidak bisa menyisipkan perintah)", () => {
  assert.equal(
    h.appendAllowListCommand("www", "172.16.15.254"),
    '/ip service set www address=([/ip service get www address],"172.16.15.0/24")',
  );
  assert.equal(
    h.appendAllowListCommand("api", "203.0.113.5/32"),
    '/ip service set api address=([/ip service get api address],"203.0.113.5/32")',
  );
  for (const bad of ["", "abc", "1.2.3.4\"; /system reboot", "300.1.1.1", '1.2.3.4"]']) {
    assert.equal(h.appendAllowListCommand("www", bad), undefined, bad);
  }
});
test("formatAllowListEntry memakai /24 untuk IP privat agar tahan terhadap reboot DHCP", () => {
  assert.equal(h.formatAllowListEntry("192.168.0.182"), "192.168.0.0/24");
  assert.equal(h.formatAllowListEntry("10.167.80.2"), "10.167.80.0/24");
  assert.equal(h.formatAllowListEntry("172.16.5.10"), "172.16.5.0/24");
  assert.equal(h.formatAllowListEntry("203.0.113.5"), "203.0.113.5/32");
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
