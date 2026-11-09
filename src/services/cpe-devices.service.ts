// Layanan daftar CPE dari GenieACS NBI. Relatif (tanpa alias / server-only) agar bisa diuji dengan node --test.
import { GenieAcsClient } from "../lib/genieacs/client.ts";
import type { CpeDevice } from "../lib/dashboard/cpe.ts";

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
  return [d.customerName, d.pppoeUsername, d.serialNumber, d.deviceId, d.wanIp, d.lanIp, d.model].some(
    (f) => Boolean(f && f.toLowerCase().includes(needle)),
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
  // Id GenieACS memuat teks "%2D" apa adanya (mis. D05FAF-FD511GW-DF77%2D2511027460): coba
  // sesuai diterima dulu, baru bentuk yang di-decode lagi. Men-decode di route saja membuat
  // modem seperti ini "tidak ditemukan".
  let decoded = id;
  try {
    decoded = decodeURIComponent(id);
  } catch {
    // bukan escape yang sah: pakai apa adanya
  }
  return (await client.getDevice(id)) ?? (decoded !== id ? await client.getDevice(decoded) : null);
}
