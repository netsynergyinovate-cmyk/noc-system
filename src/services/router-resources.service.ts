import "server-only";
import { db } from "@/db";
import { routers as routersTable } from "@/db/schema";
import { env } from "@/lib/env";
import { decryptAES256GCM } from "@/lib/encryption";
import { MikrotikRestClient } from "@/lib/mikrotik/client";
import {
  defaultRouterDetails,
  summarizeRouterResources,
  type MockRouterDetail,
  type RouterResourceSummary,
} from "@/lib/dashboard/routers";

export interface RouterResourcesResult {
  summary: RouterResourceSummary;
  items: MockRouterDetail[];
}

const pack = (items: MockRouterDetail[]): RouterResourcesResult => ({
  summary: summarizeRouterResources(items),
  items,
});

const clampPct = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

// Hanya kolom non-rahasia + passwordEnc (dipakai di server untuk login ke router,
// tidak pernah masuk ke item hasil).
export async function getRouterResourcesSummary(): Promise<RouterResourcesResult> {
  const mock = () => pack(defaultRouterDetails.map((d) => ({ ...d })));
  if (env.DASHBOARD_DATA === "demo") return mock();

  const rows = await db
    .select({
      id: routersTable.id,
      name: routersTable.name,
      host: routersTable.host,
      username: routersTable.username,
      passwordEnc: routersTable.passwordEnc,
      status: routersTable.status,
    })
    .from(routersTable);
  if (rows.length === 0) return mock();

  const results = await Promise.allSettled(
    rows.map((r) => {
      if (r.status !== "aktif") return Promise.reject(new Error("nonaktif"));
      return new MikrotikRestClient({
        host: r.host,
        username: r.username,
        password: decryptAES256GCM(r.passwordEnc),
        mode: "real",
      }).getResource();
    }),
  );

  const items = rows.map((r, i): MockRouterDetail => {
    const base = {
      id: r.id,
      name: r.name,
      host: r.host,
      role: "Gateway",
      queueCount: 0,
      temperature: 0,
      pppoeCount: 0,
    };
    const res = results[i];
    if (res.status === "rejected") {
      return {
        ...base,
        boardModel: "-",
        rosVersion: "-",
        cpuLoad: 0,
        memoryUsage: 0,
        uptime: "Offline",
        active: false,
      };
    }
    const m = res.value;
    return {
      ...base,
      boardModel: m.boardName,
      rosVersion: m.version,
      cpuLoad: clampPct(m.cpuLoad),
      memoryUsage: m.totalMemory > 0 ? clampPct(((m.totalMemory - m.freeMemory) / m.totalMemory) * 100) : 0,
      uptime: m.uptime,
      active: true,
    };
  });
  return pack(items);
}
