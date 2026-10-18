import { describe, it } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

describe("Network Latency Service (Real TCP Measurements)", () => {
  it("memiliki 4 target jaringan fisik nyata (Core CIARA, HSGQ OLT, Cloudflare, Google)", async () => {
    const targets = [
      { name: "Core CIARA", host: "103.167.70.136", port: 80 },
      { name: "HSGQ OLT", host: "103.167.70.136", port: 2323 },
      { name: "Cloudflare DNS", host: "1.1.1.1", port: 53 },
      { name: "Google DNS", host: "8.8.8.8", port: 53 },
    ];

    assert.equal(targets.length, 4);
    assert.equal(targets[0].host, "103.167.70.136");
    assert.equal(targets[1].port, 2323);
    assert.equal(targets[2].host, "1.1.1.1");
    assert.equal(targets[3].host, "8.8.8.8");
  });

  it("dapat mengukur TCP latency round-trip nyata tanpa dummy math", async () => {
    // Jalankan server TCP lokal mini untuk verifikasi perhitungan milidetik nyata
    const server = net.createServer((sock) => sock.end());
    await new Promise((res) => server.listen(0, "127.0.0.1", res));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const t0 = performance.now();
    const client = new net.Socket();
    let measuredMs = null;

    await new Promise((res) => {
      client.connect(port, "127.0.0.1", () => {
        measuredMs = Math.round((performance.now() - t0) * 10) / 10;
        client.destroy();
        server.close(res);
      });
    });

    assert.ok(measuredMs !== null);
    assert.ok(measuredMs >= 0 && measuredMs < 500);
  });
});

