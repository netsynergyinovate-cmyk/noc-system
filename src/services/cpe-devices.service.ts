// Layanan daftar CPE dari GenieACS NBI. Relatif (tanpa alias / server-only) agar bisa diuji dengan node --test.
import { GenieAcsClient } from "../lib/genieacs/client.ts";
import type { CpeDevice } from "../lib/dashboard/cpe-mock.ts";

export const CPE_DEFAULT_LIMIT = 20;
export const CPE_MAX_LIMIT = 100;

export type CpeStatusFilter = "all" | "online" | "offline";

export interface ListCpeOptions {
  search?: string;
  status?: CpeStatusFilter;
  page?: number;
  limit?: number;
  client?: GenieAcsClient;
}

export interface ListCpeResult {
  data: CpeDevice[];
  total: number;
  page: number;
  limit: number;
}

function positiveInt(value: number | undefined, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (value === undefined || !Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, max);
}

function matchesSearch(d: CpeDevice, needle: string): boolean {
  return [d.customerName, d.pppoeUsername, d.serialNumber, d.deviceId, d.wanIp, d.lanIp, d.model].some((f) =>
    f.toLowerCase().includes(needle),
  );
}

export async function listCpeDevices(options: ListCpeOptions = {}): Promise<ListCpeResult> {
  const { search, status = "all", client = new GenieAcsClient() } = options;
  const page = positiveInt(options.page, 1);
  const limit = positiveInt(options.limit, CPE_DEFAULT_LIMIT, CPE_MAX_LIMIT);

  const needle = search?.trim().toLowerCase();
  const filtered = (await client.listDevices()).filter(
    (d) =>
      (status === "all" || d.isOnline === (status === "online")) && (!needle || matchesSearch(d, needle)),
  );

  const offset = (page - 1) * limit;
  return { data: filtered.slice(offset, offset + limit), total: filtered.length, page, limit };
}

export async function getCpeDevice(id: string, client: GenieAcsClient = new GenieAcsClient()): Promise<CpeDevice | null> {
  return client.getDevice(id);
}
