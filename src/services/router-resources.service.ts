import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { routers as routersTable, trafficSamples } from "@/db/schema";
import { env } from "@/lib/env";
import { decryptAES256GCM } from "@/lib/encryption";
import { MikrotikRestClient } from "@/lib/mikrotik/client";
import {
  defaultRouterDetails,
  formatRouterOsUptime,
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

// Cache pembacaan byte antarmuka untuk kalkulasi laju real-time lintas pemanggilan HTTP
const ifaceCache = new Map<string, { rxByte: number; txByte: number; ts: number }>();

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
      protocol: routersTable.protocol,
      status: routersTable.status,
    })
    .from(routersTable);
  // Mode live tanpa router terdaftar: kosong, bukan contoh tiruan.
  if (rows.length === 0) return pack([]);

  // Sumber sekunder (jumlah queue, suhu, antarmuka) boleh gagal tanpa menjatuhkan kartu router:
  // router tanpa sensor atau tanpa hak baca queue tetap menampilkan CPU dan memori.
  const extras = new Map<
    string,
    {
      queueCount: number;
      temperature: number;
      latencyMs: number;
      currentDownloadMbps?: number;
      currentUploadMbps?: number;
      peakMbps?: number;
      interfaces: MockRouterDetail["interfaces"];
    }
  >();

  const results = await Promise.allSettled(
    rows.map(async (r) => {
      if (r.status !== "aktif") throw new Error("nonaktif");
      const client = new MikrotikRestClient({
        host: r.host,
        username: r.username,
        password: decryptAES256GCM(r.passwordEnc),
        routerId: r.id,
        mode: "real",
      });
      const t0 = performance.now();
      const resource = await client.getResource();
      const latencyMs = Math.max(0.8, Math.round((performance.now() - t0) * 10) / 10);

      const [queues, temperature, ifaces] = await Promise.all([
        client.getQueues().then((q) => q.length, () => 0),
        client.getTemperature().catch(() => 0),
        (async () => {
          try {
            let list = await client.getInterfaces();
            const hasPrior = ifaceCache.has(`${r.id}:ether2-lan0`);
            let tNow = Date.now();
            if (!hasPrior && list.length > 0) {
              // Simpan sampel awal lalu tunggu sejenak untuk delta pertama (400ms)
              for (const it of list) {
                ifaceCache.set(`${r.id}:${it.name}`, { rxByte: it.rxByte, txByte: it.txByte, ts: tNow });
              }
              await new Promise((res) => setTimeout(res, 400));
              const secondList = await client.getInterfaces().catch(() => null);
              if (secondList && secondList.length > 0) {
                list = secondList;
                tNow = Date.now();
              }
            }

            return list
              .filter((it) => !it.disabled && !it.name.startsWith("<pppoe-"))
              .map((it) => {
                const cacheKey = `${r.id}:${it.name}`;
                const prev = ifaceCache.get(cacheKey);
                let rxMbps = 0;
                let txMbps = 0;
                if (prev && tNow > prev.ts) {
                  const dtSec = (tNow - prev.ts) / 1000;
                  if (dtSec >= 0.35 && dtSec <= 30) {
                    const dRx = it.rxByte >= prev.rxByte ? it.rxByte - prev.rxByte : it.rxByte;
                    const dTx = it.txByte >= prev.txByte ? it.txByte - prev.txByte : it.txByte;
                    rxMbps = Math.max(0, Math.round(((dRx * 8) / (dtSec * 1_000_000)) * 10) / 10);
                    txMbps = Math.max(0, Math.round(((dTx * 8) / (dtSec * 1_000_000)) * 10) / 10);
                  }
                }
                ifaceCache.set(cacheKey, { rxByte: it.rxByte, txByte: it.txByte, ts: tNow });
                return {
                  id: it.id,
                  name: it.name,
                  type: it.type,
                  running: it.running,
                  rxByte: it.rxByte,
                  txByte: it.txByte,
                  rxMbps,
                  txMbps,
                  comment: it.comment,
                };
              });
          } catch {
            return [];
          }
        })(),
      ]);

      // Cari uplink interface (ether2-lan0 atau dengan komentar UPLINK)
      const uplinkIface = ifaces.find(
        (i) => i.comment?.toUpperCase().includes("UPLINK") || i.name === "ether2-lan0",
      );

      let currentDl = uplinkIface?.rxMbps;
      let currentUl = uplinkIface?.txMbps;

      // Ambil sampel trafik riil terakhir dari database jika ada. Tidak ada
      // angka contoh: field yang belum terbaca dibiarkan undefined.
      try {
        const [latestSample] = await db
          .select({
            rxMbps: trafficSamples.rxMbps,
            txMbps: trafficSamples.txMbps,
          })
          .from(trafficSamples)
          .where(eq(trafficSamples.routerId, r.id))
          .orderBy(desc(trafficSamples.sampledAt))
          .limit(1);

        if (latestSample) {
          const dbDl = Math.round(Number(latestSample.rxMbps) * 10) / 10;
          const dbUl = Math.round(Number(latestSample.txMbps) * 10) / 10;
          if (currentDl === undefined || currentDl === 0) currentDl = dbDl;
          if (currentUl === undefined || currentUl === 0) currentUl = dbUl;
        }
      } catch {
        // Belum ada sampel di DB: biarkan undefined.
      }

      extras.set(r.id, {
        queueCount: queues,
        temperature,
        latencyMs,
        currentDownloadMbps: currentDl,
        currentUploadMbps: currentUl,
        interfaces: ifaces,
      });
      return resource;
    }),
  );

  const items = rows.map((r, i): MockRouterDetail => {
    const base = {
      id: r.id,
      name: r.name,
      host: r.host,
      protocol: r.protocol,
      role: "Gateway Utama + BRAS",
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
    const extra = extras.get(r.id);
    return {
      ...base,
      // Hanya nilai yang benar-benar dibaca. Tidak ada 1.4 ms, ASN, atau trafik
      // contoh: field yang belum terukur dibiarkan undefined ("—").
      queueCount: extra?.queueCount,
      temperature: extra?.temperature,
      latencyMs: extra?.latencyMs,
      currentDownloadMbps: extra?.currentDownloadMbps,
      currentUploadMbps: extra?.currentUploadMbps,
      peakMbps: extra?.peakMbps,
      interfaces: extra?.interfaces,
      boardModel: m.boardName,
      rosVersion: m.version,
      cpuLoad: clampPct(m.cpuLoad),
      memoryUsage: m.totalMemory > 0 ? clampPct(((m.totalMemory - m.freeMemory) / m.totalMemory) * 100) : 0,
      uptime: formatRouterOsUptime(m.uptime),
      active: true,
    };
  });
  return pack(items);
}
