import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { routers as routersTable, customers as customersTable } from "@/db/schema";
import { env } from "@/lib/env";
import { decryptAES256GCM } from "@/lib/encryption";
import { MikrotikRestClient } from "@/lib/mikrotik/client";
import { formatRouterOsUptime } from "@/lib/dashboard/routers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RouterPppoeSession {
  id: string;
  name: string;
  service: string;
  callerId: string;
  address: string;
  uptime: string;
  uptimeHuman: string;
  sessionId?: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
}

export async function getRouterPppoeSessions(
  routerId: string,
  query = "",
): Promise<RouterPppoeSession[]> {
  // Demo mode fallback
  if (routerId.startsWith("router-") || env.DASHBOARD_DATA === "demo") {
    const mock = Array.from({ length: 69 }, (_, i) => ({
      id: `*${(i + 1).toString(16).toUpperCase()}`,
      name: `1706000${1100 + i}@runsnet.id`,
      service: "pppoe",
      callerId: `98:7D:DD:6D:${((i + 10) % 256).toString(16).padStart(2, "0").toUpperCase()}:A7`,
      address: `172.16.15.${254 - (i % 250)}`,
      uptime: `${Math.floor(i / 10) + 1}h${(i * 7) % 60}m`,
      uptimeHuman: `${Math.floor(i / 10) + 1} jam ${(i * 7) % 60} menit`,
      customerName: `Pelanggan Runsnet ${i + 1}`,
    }));
    return filterSessions(mock, query);
  }

  if (!UUID.test(routerId)) return [];

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

  if (!r || r.status !== "aktif") return [];

  const client = new MikrotikRestClient({
    host: r.host,
    username: r.username,
    password: decryptAES256GCM(r.passwordEnc),
    routerId,
    mode: "real",
  });

  const [rawSessions, allCustomers] = await Promise.all([
    client.getPppActive().catch(() => []),
    db
      .select({
        name: customersTable.name,
        pppoeUsername: customersTable.pppoeUsername,
        address: customersTable.address,
      })
      .from(customersTable)
      .catch(() => []),
  ]);

  const customerMap = new Map(
    allCustomers
      .filter((c) => Boolean(c.pppoeUsername))
      .map((c) => [c.pppoeUsername.toLowerCase().trim(), c]),
  );

  const sessions: RouterPppoeSession[] = rawSessions.map((s) => {
    const cust = customerMap.get(s.name.toLowerCase().trim());
    return {
      id: s.id,
      name: s.name,
      service: s.service,
      callerId: s.callerId,
      address: s.address,
      uptime: s.uptime,
      uptimeHuman: formatRouterOsUptime(s.uptime),
      sessionId: s.sessionId,
      customerName: cust?.name,
      customerPhone: undefined,
      customerAddress: cust?.address || undefined,
    };
  });

  return filterSessions(sessions, query);
}

function filterSessions(list: RouterPppoeSession[], q: string): RouterPppoeSession[] {
  if (!q.trim()) return list;
  const lower = q.toLowerCase().trim();
  return list.filter(
    (s) =>
      s.name.toLowerCase().includes(lower) ||
      s.address.toLowerCase().includes(lower) ||
      s.callerId.toLowerCase().includes(lower) ||
      (s.customerName && s.customerName.toLowerCase().includes(lower)),
  );
}
