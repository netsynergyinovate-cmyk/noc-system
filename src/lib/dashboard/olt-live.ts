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

export interface AutoMatchSummary {
  matched: number;
  ambiguous: number;
  unmatched: number;
  namesFilled: number;
}

export type AutoMatchResult =
  | { ok: true; summary: AutoMatchSummary }
  | { ok: false; message: string };

// Mencocokkan ONU ke pelanggan di semua OLT aktif (nomor PPPoE di nama ONU, kode
// nama, dst). Hanya yang cocok tunggal yang dipetakan; hasilnya dijumlahkan.
export async function autoMatchAllLive(): Promise<AutoMatchResult> {
  let olts: Awaited<ReturnType<typeof fetchLiveOlts>>;
  try {
    olts = await fetchLiveOlts();
  } catch {
    return { ok: false, message: "Daftar OLT belum bisa dimuat dari server." };
  }
  if (olts.length === 0) return { ok: false, message: "Belum ada OLT terdaftar." };
  const total: AutoMatchSummary = { matched: 0, ambiguous: 0, unmatched: 0, namesFilled: 0 };
  for (const olt of olts) {
    let res: Response;
    try {
      res = await fetch(`/api/olts/${encodeURIComponent(olt.id)}/match`, { method: "POST" });
    } catch {
      return { ok: false, message: "Server aplikasi tidak terjangkau." };
    }
    if (res.status === 403) return { ok: false, message: "Akun Anda tidak punya izin mencocokkan ONU (butuh peran admin)." };
    if (!res.ok) return { ok: false, message: `Server gagal mencocokkan ONU ${olt.name} (HTTP ${res.status}).` };
    const json = (await res.json().catch(() => null)) as { data?: Partial<AutoMatchSummary> } | null;
    total.matched += json?.data?.matched ?? 0;
    total.ambiguous += json?.data?.ambiguous ?? 0;
    total.unmatched += json?.data?.unmatched ?? 0;
    total.namesFilled += json?.data?.namesFilled ?? 0;
  }
  return { ok: true, summary: total };
}

export async function renameOnuLive(
  oltId: string,
  pon: number,
  onu: number,
  description: string,
): Promise<{ ok: boolean; message: string }> {
  let res: Response;
  try {
    res = await fetch(`/api/olts/${encodeURIComponent(oltId)}/onus/${pon}/${onu}/description`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
  } catch {
    return { ok: false, message: "Server aplikasi tidak terjangkau." };
  }
  const json = (await res.json().catch(() => null)) as { message?: string; error?: { message?: string } } | null;
  if (res.ok) {
    return { ok: true, message: json?.message ?? `ONU ${pon}/${onu} dinamai "${description}".` };
  }
  return { ok: false, message: json?.error?.message ?? `Gagal menamai ONU di OLT (HTTP ${res.status}).` };
}

export async function syncAllOnuNamesLive(): Promise<{
  ok: boolean;
  message: string;
  summary?: { total: number; updated: number; skipped: number; failed: number };
}> {
  let olts: Awaited<ReturnType<typeof fetchLiveOlts>>;
  try {
    olts = await fetchLiveOlts();
  } catch {
    return { ok: false, message: "Daftar OLT belum bisa dimuat dari server." };
  }
  if (olts.length === 0) return { ok: false, message: "Belum ada OLT terdaftar." };

  const total = { total: 0, updated: 0, skipped: 0, failed: 0 };
  for (const olt of olts) {
    let res: Response;
    try {
      res = await fetch(`/api/olts/${encodeURIComponent(olt.id)}/sync-names`, { method: "POST" });
    } catch {
      return { ok: false, message: "Server aplikasi tidak terjangkau." };
    }
    if (res.status === 403) return { ok: false, message: "Akun Anda tidak punya izin menamai ONU (butuh cpe:manage)." };
    if (!res.ok) return { ok: false, message: `Server gagal menamai ONU di ${olt.name} (HTTP ${res.status}).` };
    const json = (await res.json().catch(() => null)) as { summary?: typeof total } | null;
    if (json?.summary) {
      total.total += json.summary.total;
      total.updated += json.summary.updated;
      total.skipped += json.summary.skipped;
      total.failed += json.summary.failed;
    }
  }
  return {
    ok: true,
    summary: total,
    message: `${total.updated} ONU dinamai di OLT, ${total.skipped} sudah sesuai, ${total.failed} gagal.`,
  };
}
