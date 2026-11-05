import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { routers as routersTable } from "@/db/schema";
import { env } from "@/lib/env";
import { decryptAES256GCM } from "@/lib/encryption";
import { MikrotikRestClient, type MikrotikPingPacket } from "@/lib/mikrotik/client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGET_REGEX = /^([a-zA-Z0-9][-a-zA-Z0-9.]*[a-zA-Z0-9]|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;

export interface RouterPingResult {
  ok: boolean;
  target: string;
  count: number;
  packets: Array<{
    seq: number;
    host: string;
    size: number;
    ttl: number;
    time: string;
    packetLoss: number;
  }>;
  stats: {
    sent: number;
    received: number;
    packetLossPct: number;
    minRtt?: string;
    avgRtt?: string;
    maxRtt?: string;
  };
  terminalLines: string[];
}

export async function pingFromRouter(
  routerId: string,
  targetInput: string,
  countInput = 4,
): Promise<RouterPingResult> {
  const target = targetInput.trim();
  if (!TARGET_REGEX.test(target)) {
    throw new Error("Target host atau IP tidak valid.");
  }
  const count = Math.min(Math.max(1, countInput), 10);

  if (routerId.startsWith("router-") || env.DASHBOARD_DATA === "demo") {
    const mockPackets = Array.from({ length: count }, (_, i) => ({
      seq: i,
      host: target,
      size: 56,
      ttl: 64,
      time: `${(1.2 + i * 0.1).toFixed(2)}ms`,
      packetLoss: 0,
    }));
    return formatPingOutput(target, count, mockPackets);
  }

  if (!UUID.test(routerId)) {
    throw new Error("ID router tidak valid.");
  }

  const [r] = await db
    .select({
      host: routersTable.host,
      username: routersTable.username,
      passwordEnc: routersTable.passwordEnc,
      status: routersTable.status,
    })
    .from(routersTable)
    .where(eq(routersTable.id, routerId))
    .limit(1);

  if (!r || r.status !== "aktif") {
    throw new Error("Router tidak ditemukan atau tidak aktif.");
  }

  const client = new MikrotikRestClient({
    host: r.host,
    username: r.username,
    password: decryptAES256GCM(r.passwordEnc),
    routerId,
    mode: "real",
  });

  const rawPackets = await client.ping(target, count);
  return formatPingOutput(target, count, rawPackets);
}

function formatPingOutput(
  target: string,
  count: number,
  packets: MikrotikPingPacket[],
): RouterPingResult {
  const received = packets.filter((p) => p.packetLoss === 0).length;
  const lossPct = count > 0 ? Math.round(((count - received) / count) * 100) : 0;

  const lines: string[] = [
    `PING ${target} (${target}) 56(84) bytes of data.`,
  ];

  for (const p of packets) {
    if (p.packetLoss === 0) {
      lines.push(
        `${p.size || 56} bytes from ${p.host || target}: icmp_seq=${p.seq + 1} ttl=${p.ttl || 64} time=${p.time}`,
      );
    } else {
      lines.push(`Request timeout for icmp_seq ${p.seq + 1}`);
    }
  }

  const last = packets[packets.length - 1];
  const minRtt = last?.minRtt || (packets[0]?.time ?? "1.2ms");
  const avgRtt = last?.avgRtt || (packets[0]?.time ?? "1.4ms");
  const maxRtt = last?.maxRtt || (packets[packets.length - 1]?.time ?? "1.6ms");

  lines.push(`--- ${target} ping statistics ---`);
  lines.push(
    `${count} packets transmitted, ${received} received, ${lossPct}% packet loss`,
  );
  if (received > 0) {
    lines.push(`rtt min/avg/max = ${minRtt}/${avgRtt}/${maxRtt}`);
  }

  return {
    ok: received > 0,
    target,
    count,
    packets: packets.map((p) => ({
      seq: p.seq,
      host: p.host,
      size: p.size,
      ttl: p.ttl,
      time: p.time,
      packetLoss: p.packetLoss,
    })),
    stats: {
      sent: count,
      received,
      packetLossPct: lossPct,
      minRtt,
      avgRtt,
      maxRtt,
    },
    terminalLines: lines,
  };
}

