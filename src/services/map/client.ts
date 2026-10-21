import "server-only";
import { listCpeDevices } from "@/services/cpe-devices.service";
import { readExternalDataset } from "@/services/external-data.service";
import { snapToRoads } from "@/services/road-snap.service";
import { getRouterQueues } from "@/services/router-queues.service";
import { getVlanPonTraffic } from "@/services/vlan-traffic.service";
import type { OltRange } from "./types";

// Peta membaca data NOC langsung di proses yang sama (dulu lewat HTTP + API key).
// JSON bolak-balik menjaga bentuk baris persis seperti respons /api/v1/data
// (Date jadi string ISO), sesuai yang diharapkan central-mapper.
const asJson = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;

export async function fetchDataset<T>(dataset: string): Promise<T[]> {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await readExternalDataset(dataset, { limit: 1000, offset });
    rows.push(...page.rows);
    if (!page.hasMore) return asJson<T[]>(rows);
  }
}

export const fetchCpe = async <T>(search: string) =>
  asJson<T>(await listCpeDevices({ search, limit: 5 }));

export const fetchVlanTraffic = async <T>(range: OltRange) =>
  asJson<T>({ data: await getVlanPonTraffic({ range }) });

export const fetchRouterQueues = async <T>(routerId: string, query: string) =>
  asJson<T>({ data: await getRouterQueues(routerId, query.slice(0, 100)) });

export const fetchSnap = (points: [number, number][], toleranceM: number) =>
  snapToRoads(points, toleranceM);
