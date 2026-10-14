import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

process.env.DATABASE_URL ??= "postgresql://x:x@127.0.0.1:5432/x";
process.env.BETTER_AUTH_SECRET ??= "s".repeat(32);
process.env.BETTER_AUTH_URL ??= "http://localhost:3101";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };

register();

const {
  normalizeProtocol,
  parseNetflowV5Buffer,
  ingestNetflowFlows,
} = await import("../src/services/netflow.service.ts");

test("normalizeProtocol: konversi nomor protokol dan string", () => {
  assert.equal(normalizeProtocol(6), "TCP");
  assert.equal(normalizeProtocol(17), "UDP");
  assert.equal(normalizeProtocol(1), "ICMP");
  assert.equal(normalizeProtocol(47), "GRE");
  assert.equal(normalizeProtocol(89), "OSPF");
  assert.equal(normalizeProtocol(999), "PROTO_999");
  assert.equal(normalizeProtocol("tcp"), "TCP");
  assert.equal(normalizeProtocol("17"), "UDP");
  assert.equal(normalizeProtocol(""), "OTHER");
});

test("parseNetflowV5Buffer: mem-parse buffer biner NetFlow v5", () => {
  const buf = Buffer.alloc(24 + 48);
  // Header: Version = 5, Count = 1, SysUptime = 1000, UnixSecs = 1700000000
  buf.writeUInt16BE(5, 0);
  buf.writeUInt16BE(1, 2);
  buf.writeUInt32BE(1000, 4);
  buf.writeUInt32BE(1_700_000_000, 8);

  // Record 0 (offset 24):
  // src = 192.168.1.50
  buf[24] = 192;
  buf[25] = 168;
  buf[26] = 1;
  buf[27] = 50;
  // dst = 1.1.1.1
  buf[28] = 1;
  buf[29] = 1;
  buf[30] = 1;
  buf[31] = 1;

  // pkts (offset 24 + 16 = 40)
  buf.writeUInt32BE(5, 40);
  // bytes (offset 24 + 20 = 44)
  buf.writeUInt32BE(1500, 44);
  // srcPort (offset 24 + 32 = 56)
  buf.writeUInt16BE(45678, 56);
  // dstPort (offset 24 + 34 = 58)
  buf.writeUInt16BE(443, 58);
  // proto (offset 24 + 38 = 62): 6 = TCP
  buf[62] = 6;

  const records = parseNetflowV5Buffer(buf);
  assert.equal(records.length, 1);
  const r = records[0];
  assert.equal(r.srcIp, "192.168.1.50");
  assert.equal(r.dstIp, "1.1.1.1");
  assert.equal(r.srcPort, 45678);
  assert.equal(r.dstPort, 443);
  assert.equal(r.protocol, 6);
  assert.equal(r.packets, 5);
  assert.equal(r.bytes, 1500);
  assert.equal(r.capturedAt.getTime(), 1_700_000_000 * 1000);
});

test("parseNetflowV5Buffer: validasi error pada paket rusak", () => {
  // Kurang dari header
  assert.throws(() => parseNetflowV5Buffer(Buffer.alloc(20)), /kurang dari 24/);

  // Versi salah
  const badVer = Buffer.alloc(24 + 48);
  badVer.writeUInt16BE(9, 0);
  badVer.writeUInt16BE(1, 2);
  assert.throws(() => parseNetflowV5Buffer(badVer), /bukan NetFlow v5/);

  // Count 0
  const zeroCount = Buffer.alloc(24);
  zeroCount.writeUInt16BE(5, 0);
  zeroCount.writeUInt16BE(0, 2);
  assert.throws(() => parseNetflowV5Buffer(zeroCount), /Jumlah record tidak valid/);

  // Buffer terpotong
  const truncated = Buffer.alloc(24 + 20);
  truncated.writeUInt16BE(5, 0);
  truncated.writeUInt16BE(1, 2);
  assert.throws(() => parseNetflowV5Buffer(truncated), /tidak cukup/);
});

test("ingestNetflowFlows: mengabaikan baris kosong atau port tidak valid", async () => {
  const res = await ingestNetflowFlows([
    { srcIp: "", dstIp: "1.1.1.1", srcPort: 80, dstPort: 80, protocol: "TCP", bytes: 100 },
    { srcIp: "1.1.1.1", dstIp: "", srcPort: 80, dstPort: 80, protocol: "TCP", bytes: 100 },
    { srcIp: "1.1.1.1", dstIp: "2.2.2.2", srcPort: -1, dstPort: 80, protocol: "TCP", bytes: 100 },
    { srcIp: "1.1.1.1", dstIp: "2.2.2.2", srcPort: 80, dstPort: 70000, protocol: "TCP", bytes: 100 },
  ]);
  assert.equal(res.inserted, 0);
  assert.equal(res.totalBytes, 0);
});
