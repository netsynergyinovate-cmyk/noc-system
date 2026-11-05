import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { routers as routersTable } from "@/db/schema";
import { env } from "@/lib/env";
import { decryptAES256GCM } from "@/lib/encryption";
import { MikrotikRestClient, type MikrotikSimpleQueue } from "@/lib/mikrotik/client";
import { createMockCustomers } from "@/lib/dashboard/mock-data";
import {
  filterSimpleQueues,
  generateMockSimpleQueues,
  type MockSimpleQueue,
  type QueueStatusFilter,
} from "@/lib/dashboard/routers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// RouterOS: "10M/20M", "512k/1G", "0/0" (0 = tanpa batas) -> bit/detik.
function parseBps(v: string): number {
  const m = /^(\d+(?:\.\d+)?)([kKmMgG]?)$/.exec(v.trim());
  if (!m) return 0;
  const mult = { "": 1, k: 1e3, m: 1e6, g: 1e9 }[m[2].toLowerCase() as "" | "k" | "m" | "g"];
  return Math.round(Number(m[1]) * mult);
}

// "up/down" -> { upload, download }
function pair(v: string): { upload: number; download: number } {
  const [u = "", d = ""] = v.split("/");
  return { upload: parseBps(u), download: parseBps(d) };
}

function toMock(routerId: string, q: MikrotikSimpleQueue): MockSimpleQueue {
  return {
    id: q.id,
    routerId,
    name: q.name,
    target: q.target,
    maxLimit: pair(q.maxLimit),
    rate: pair(q.rate),
    bytes: pair(q.bytes),
    dropped: 0, // ponytail: klien REST belum membawa "dropped"; tambahkan saat dipetakan.
    disabled: q.disabled,
    comment: q.comment || undefined,
  };
}

export async function getRouterQueues(
  routerId: string,
  query = "",
  status: QueueStatusFilter = "all",
): Promise<MockSimpleQueue[]> {
  if (routerId.startsWith("router-") || env.DASHBOARD_DATA === "demo") {
    return filterSimpleQueues(generateMockSimpleQueues(routerId, createMockCustomers()), query, status);
  }
  if (!UUID.test(routerId)) return [];

  const [r] = await db
    .select({
      host: routersTable.host,
      username: routersTable.username,
      passwordEnc: routersTable.passwordEnc,
    })
    .from(routersTable)
    .where(eq(routersTable.id, routerId))
    .limit(1);
  if (!r) return [];

  const raw = await new MikrotikRestClient({
    host: r.host,
    username: r.username,
    password: decryptAES256GCM(r.passwordEnc),
    routerId,
    mode: "real",
  }).getQueues();
  return filterSimpleQueues(
    raw.map((q) => toMock(routerId, q)),
    query,
    status,
  );
}
