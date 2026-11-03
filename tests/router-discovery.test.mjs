import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { register } from "tsx/esm/api";

register();
const { parseDefaultGateways, parseMikrotikNeighbors, expandCidr, isPrivateIPv4, probeRest, sourceIpFor } = await import(
  "../src/services/router-discovery.ts"
);

test("parseDefaultGateways membaca rute bawaan (heksadesimal little-endian), mengabaikan rute non-bawaan", () => {
  const table = [
    "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT",
    "enp2s0\t00000000\t0100A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0",
    "enp2s0\t0000A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0",
    "docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0",
  ].join("\n");
  assert.deepEqual(parseDefaultGateways(table), ["192.168.0.1"]);
});

test("parseMikrotikNeighbors hanya mengambil tetangga ber-OUI MikroTik", () => {
  const arp = [
    "IP address       HW type     Flags       HW address            Mask     Device",
    "10.20.30.1       0x1         0x2         6c:3b:6b:11:22:33     *        eth0",
    "10.20.30.7       0x1         0x2         aa:bb:cc:11:22:33     *        eth0",
  ].join("\n");
  assert.deepEqual(parseMikrotikNeighbors(arp), ["10.20.30.1"]);
});

test("expandCidr: /24 tanpa alamat jaringan/siaran; menolak rentang publik, terlalu besar, atau format salah", () => {
  const hosts = expandCidr("10.20.30.0/24");
  assert.equal(hosts.length, 254);
  assert.equal(hosts[0], "10.20.30.1");
  assert.equal(hosts.at(-1), "10.20.30.254");
  assert.throws(() => expandCidr("10.0.0.0/16"), /\/24/);
  assert.throws(() => expandCidr("8.8.8.0/24"), /privat/);
  assert.throws(() => expandCidr("bukan-rentang"), /Format/);
  assert.equal(isPrivateIPv4("100.64.1.1"), true);
  assert.equal(isPrivateIPv4("103.167.70.136"), false);
});

function listen(handler) {
  const { promise, resolve } = Promise.withResolvers();
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1", () => resolve(server));
  return promise;
}

test("probeRest: 401 Basic = REST MikroTik hidup; layanan web lain dan port tertutup = bukan", async () => {
  const mikrotik = await listen((_req, res) => {
    res.writeHead(401, { "WWW-Authenticate": "Basic" });
    res.end();
  });
  const other = await listen((_req, res) => {
    res.writeHead(200);
    res.end("hello");
  });
  const nonBasic = await listen((_req, res) => {
    res.writeHead(401, { "WWW-Authenticate": "Bearer" });
    res.end();
  });
  try {
    assert.deepEqual(await probeRest("127.0.0.1", mikrotik.address().port), { port: mikrotik.address().port, tls: false, status: 401 });
    // Server web biasa yang menjawab 200 teks untuk semua path bukan REST MikroTik (REST menjawab JSON).
    assert.equal(await probeRest("127.0.0.1", other.address().port), null);
    const json = await listen((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
    try {
      assert.deepEqual(await probeRest("127.0.0.1", json.address().port), { port: json.address().port, tls: false, status: 200 });
    } finally {
      json.close();
    }
    assert.equal(await probeRest("127.0.0.1", nonBasic.address().port), null);
  } finally {
    for (const s of [mikrotik, other, nonBasic]) s.close();
  }
  assert.equal(await probeRest("127.0.0.1", 1), null);
});

test("sourceIpFor memilih alamat sumber tanpa mengirim paket: loopback untuk host loopback", async () => {
  assert.equal(await sourceIpFor("127.0.0.1", 80), "127.0.0.1");
});

test("probeRest: TCP tersambung lalu diputus dilaporkan 'reset' (ciri allow-list), bukan 'tidak ada'", async () => {
  const { promise, resolve } = Promise.withResolvers();
  const net = await import("node:net");
  const server = net.createServer((socket) => socket.destroy());
  server.listen(0, "127.0.0.1", () => resolve());
  await promise;
  try {
    assert.deepEqual(await probeRest("127.0.0.1", server.address().port), { port: server.address().port, tls: false, status: "reset" });
  } finally {
    server.close();
  }
});
