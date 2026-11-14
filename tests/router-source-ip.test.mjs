import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { register } from "tsx/esm/api";

register();
const { outboundSourceIp } =
  await import("../src/services/outbound-source-ip.ts");
const { describeConnectionTroubleshoot: d } =
  await import("../src/components/dashboard/connection-error-notice.tsx");

function listen() {
  const { promise, resolve } = Promise.withResolvers();
  const server = net.createServer((s) => s.destroy());
  server.listen(0, "127.0.0.1", () => resolve(server));
  return promise;
}

test("outboundSourceIp mengembalikan alamat lokal yang dipakai untuk menyambung", async () => {
  const server = await listen();
  try {
    assert.equal(
      await outboundSourceIp("127.0.0.1", server.address().port),
      "127.0.0.1",
    );
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

test("CONNECTION_CLOSED mikrotik: judul, peringatan mengganti allow-list, command siap tempel", () => {
  const r = d("CONNECTION_CLOSED", "mikrotik", {
    sourceIp: "203.0.113.5",
    protocol: "rest",
  });
  assert.match(r.title, /menutup koneksi/i);
  assert.match(r.hint, /MENGGANTI|mempertahankan entri lama/i);
  assert.match(r.command, /203\.0\.113\.5\/32/);
  assert.match(r.command, /\/ip service set www address=203\.0\.113\.5\/32/);
  assert.doesNotMatch(r.command, /DAFTAR-LAMA|<IP-SERVER>/);
});

test("CONNECTION_CLOSED menyertakan IP publik DAN IP LAN server", () => {
  const r = d("CONNECTION_CLOSED", "mikrotik", {
    sourceIp: "203.0.113.5",
    localSourceIp: "192.168.0.182",
    protocol: "rest",
  });
  assert.equal(
    r.command,
    "/ip service set www address=203.0.113.5/32,192.168.0.182/32",
  );
});

test("CONNECTION_REFUSED mikrotik: arahkan cek port (router bisa memakai port lain), jangan menyuruh mengaktifkan www-ssl", () => {
  const r = d("CONNECTION_REFUSED", "mikrotik");
  assert.match(r.hint, /port lain|8081|kolom Port/i);
  assert.equal(r.command, '/ip service print where name~"www"');
  assert.doesNotMatch(r.command, /disabled=no|port=/);
});

test("NETWORK_ERROR mikrotik: bukan fallback generik, menyebut alamat, rute, dan firewall", () => {
  const r = d("NETWORK_ERROR", "mikrotik");
  assert.notEqual(r.title, "Koneksi gagal");
  assert.match(r.hint, /alamat/i);
  assert.match(r.hint, /rute|ping/i);
  assert.match(r.hint, /firewall/i);
});

test("CONNECTION_CLOSED menyebut kemungkinan HTTPS dicentang pada port HTTP", () => {
  assert.match(d("CONNECTION_CLOSED", "mikrotik").hint, /HTTPS/);
});

test("TIMEOUT mikrotik: petunjuk menyebut port Winbox/layanan lain, tidak generik", () => {
  const r = d("TIMEOUT", "mikrotik");
  assert.match(r.hint, /Winbox|8291|2024/);
  assert.match(r.hint, /www/);
});

test("tcpConnectedTimeoutMessage menyebut port, host, kemungkinan Winbox/API, dan arahan ke port www", async () => {
  const { tcpConnectedTimeoutMessage } =
    await import("../src/services/outbound-source-ip.ts");
  const m = tcpConnectedTimeoutMessage("10.0.0.1", 2024);
  assert.match(m, /2024/);
  assert.match(m, /10\.0\.0\.1/);
  assert.match(m, /Winbox/);
  assert.match(m, /\/ip service print/);
});

test("pickRouterSourceIp: router publik melihat IP publik (NAT), bukan IP lokal/container", async () => {
  const { pickRouterSourceIp: pick } =
    await import("../src/services/outbound-source-ip.ts");
  const base = { local: "10.0.5.6", publicIp: "203.0.113.9" };
  assert.equal(
    pick({ ...base, host: "198.51.100.1", inContainer: true }),
    "203.0.113.9",
  );
  assert.equal(
    pick({ ...base, host: "router.example.net", inContainer: false }),
    "203.0.113.9",
  );
  // IP publik tak terbaca: di container jangan menebak IP container.
  assert.equal(
    pick({ ...base, publicIp: null, host: "198.51.100.1", inContainer: true }),
    null,
  );
  assert.equal(
    pick({ ...base, publicIp: null, host: "198.51.100.1", inContainer: false }),
    "10.0.5.6",
  );
});

test("pickRouterSourceIp: router privat memakai IP lokal, kecuali di container (tidak diketahui)", async () => {
  const { pickRouterSourceIp: pick, isPrivateHost } =
    await import("../src/services/outbound-source-ip.ts");
  const base = { local: "192.168.1.10", publicIp: "203.0.113.9" };
  for (const host of [
    "192.168.1.1",
    "10.1.1.1",
    "172.16.15.1",
    "100.64.0.1",
    "[fd00::1]",
  ]) {
    assert.ok(isPrivateHost(host), host);
    assert.equal(pick({ ...base, host, inContainer: false }), "192.168.1.10");
    assert.equal(pick({ ...base, host, inContainer: true }), null);
  }
  assert.ok(!isPrivateHost("172.32.0.1"));
});
