import { apiOltToDashboard, type ApiOlt, type DashboardOlt } from "./olts.ts";
import { apiOnuToDashboard, type DashboardOnu, type LiveOnuItem } from "./onus.ts";

// KLIEN DATA OLT NYATA. Semua dari database yang diisi polling OLT oleh backend
// Go (olt_pon_ports, olt_onus), lewat API Next.js. Tidak ada data tiruan di sini:
// gagal dilaporkan sebagai galat, kosong tetap kosong.

export class OltLoadError extends Error {
  constructor(message = "Data OLT belum bisa dimuat.") {
    super(message);
    this.name = "OltLoadError";
  }
}

async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new OltLoadError("Server aplikasi tidak terjangkau.");
  }
  if (!res.ok) throw new OltLoadError(`Server menjawab HTTP ${res.status}.`);
  return (await res.json()) as T;
}

export async function fetchLiveOlts(): Promise<DashboardOlt[]> {
  const json = await getJson<{ data?: { olts?: ApiOlt[] } }>("/api/devices");
  return (json.data?.olts ?? []).map(apiOltToDashboard);
}

const PAGE = 200; // batas ONU_MAX_LIMIT di server
const MAX_PAGES = 25; // 5.000 ONU; lebih dari itu dipotong, bukan diulang tanpa batas

export interface LiveOnuResult {
  onus: DashboardOnu[];
  total: number;
  // true bila ada ONU yang tidak dimuat karena melewati batas halaman.
  truncated: boolean;
}

export async function fetchLiveOnus(): Promise<LiveOnuResult> {
  const onus: DashboardOnu[] = [];
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const json = await getJson<{ data?: { items?: LiveOnuItem[]; total?: number } }>(
      `/api/onus?limit=${PAGE}&offset=${page * PAGE}`,
    );
    const items = json.data?.items ?? [];
    total = json.data?.total ?? onus.length + items.length;
    onus.push(...items.map(apiOnuToDashboard));
    if (items.length < PAGE || onus.length >= total) break;
  }
  return { onus, total, truncated: onus.length < total };
}

// Satu ONU milik satu pelanggan (null bila belum ada ONU yang dipetakan).
export async function fetchCustomerOnu(customerId: string): Promise<LiveOnuItem | null> {
  const json = await getJson<{ data?: { items?: LiveOnuItem[] } }>(
    `/api/onus?customerId=${encodeURIComponent(customerId)}&limit=1`,
  );
  return json.data?.items?.[0] ?? null;
}

export type MapResult = { ok: true } | { ok: false; message: string };

// Memetakan ONU ke pelanggan (atau melepasnya dengan null). Server mencatat audit.
export async function mapOnuLive(onuId: string, customerId: string | null): Promise<MapResult> {
  let res: Response;
  try {
    res = await fetch(`/api/onus/${encodeURIComponent(onuId)}/map`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId }),
    });
  } catch {
    return { ok: false, message: "Server aplikasi tidak terjangkau. Pemetaan belum tersimpan." };
  }
  if (res.ok) return { ok: true };
  if (res.status === 403) return { ok: false, message: "Akun Anda tidak punya izin mengubah pemetaan ONU." };
  if (res.status === 409) return { ok: false, message: "Pelanggan ini sudah punya ONU lain. Lepas dulu pemetaan yang lama." };
  if (res.status === 404) return { ok: false, message: "ONU tidak ditemukan; mungkin sudah dihapus dari OLT." };
  return { ok: false, message: `Server gagal menyimpan pemetaan (HTTP ${res.status}).` };
}
