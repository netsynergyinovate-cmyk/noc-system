import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { register } from "tsx/esm/api";

register();
const { scanTelnetPorts, resolveScanTarget, isForbiddenScanAddress } =
  await import("../src/lib/olt/telnet-port-scan.ts");

function listen(onConn) {
  return new Promise((resolve) => {
    const s = createServer(onConn);
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}

test("klasifikasi port: telnet (IAC + banner), HTTP, diam, tertutup", async () => {
  const telnet = await listen((c) =>
    c.write(
      Buffer.concat([
        Buffer.from([255, 251, 1]),
        Buffer.from("\r\nHSGQ-XE08ID EPON OLT Operating System\r\nusername: "),
      ]),
    ),
  );
  const http = await listen((c) =>
    c.on("data", () => c.end("HTTP/1.1 404 Not Found\r\n\r\n")),
  );
  const silent = await listen(() => {});
  const closed = await listen(() => {});
  const closedPort = closed.address().port;
  await new Promise((r) => closed.close(r));
  try {
    const ports = [telnet, http, silent]
      .map((s) => s.address().port)
      .concat(closedPort);
    const r = await scanTelnetPorts("127.0.0.1", { ports, timeoutMs: 600 });
    assert.deepEqual(r.telnet, [
      {
        port: telnet.address().port,
        banner: "HSGQ-XE08ID EPON OLT Operating System",
      },
    ]);
    // Diam dan HTTP bukan telnet; port tertutup tidak dilaporkan. Server HTTP menunggu klien bicara, jadi ikut "diam".
    assert.deepEqual(
      r.otherOpen.sort(),
      [http.address().port, silent.address().port].sort(),
    );
  } finally {
    telnet.close();
    http.close();
    silent.close();
  }
});

test("alamat terlarang ditolak, jaringan privat tetap boleh", async () => {
  for (const ip of [
    "127.0.0.1",
    "127.9.9.9",
    "0.0.0.0",
    "169.254.169.254",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isForbiddenScanAddress(ip), true, ip);
  }
  for (const ip of [
    "10.10.0.10",
    "192.168.1.1",
    "172.16.5.5",
    "103.167.70.136",
    "2001:db8::1",
  ]) {
    assert.equal(isForbiddenScanAddress(ip), false, ip);
  }
  await assert.rejects(resolveScanTarget("169.254.169.254"));
  // localhost di-resolve ke loopback lalu ditolak (nama tidak melewati pemeriksaan).
  await assert.rejects(resolveScanTarget("localhost"));
  assert.equal(await resolveScanTarget("10.10.0.10"), "10.10.0.10");
});
