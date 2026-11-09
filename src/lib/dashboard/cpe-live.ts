import type { CpeDevice } from "./cpe.ts";

// MODEM NYATA dari GenieACS (TR-069) lewat GET /api/cpe. Tidak ada data tiruan di
// sini: GenieACS kosong berarti daftar kosong, GenieACS mati berarti galat.

export class CpeLoadError extends Error {
  constructor(message = "Data modem dari GenieACS belum bisa dimuat.") {
    super(message);
    this.name = "CpeLoadError";
  }
}

const PAGE = 100; // CPE_MAX_LIMIT di server
const MAX_PAGES = 20;

export interface LiveCpeResult {
  devices: CpeDevice[];
  total: number;
  truncated: boolean;
}

async function getPage(query: string): Promise<{ data: CpeDevice[]; total: number }> {
  let res: Response;
  try {
    res = await fetch(`/api/cpe?${query}`);
  } catch {
    throw new CpeLoadError("Server aplikasi tidak terjangkau.");
  }
  if (!res.ok) {
    throw new CpeLoadError(
      res.status === 500 || res.status === 502
        ? "GenieACS tidak menjawab. Pastikan container GenieACS berjalan."
        : `Server menjawab HTTP ${res.status}.`,
    );
  }
  const json = (await res.json()) as { data?: CpeDevice[]; total?: number };
  return { data: json.data ?? [], total: json.total ?? json.data?.length ?? 0 };
}

export async function fetchLiveCpe(): Promise<LiveCpeResult> {
  const devices: CpeDevice[] = [];
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const r = await getPage(`limit=${PAGE}&page=${page}`);
    total = r.total;
    devices.push(...r.data);
    if (r.data.length < PAGE || devices.length >= total) break;
  }
  return { devices, total, truncated: devices.length < total };
}

// Modem milik satu pelanggan, dicari lewat username PPPoE (tanpa membedakan huruf).
export async function fetchCpeByPppoe(pppoeUsername: string): Promise<CpeDevice | null> {
  const needle = pppoeUsername.trim().toLowerCase();
  if (!needle) return null;
  const r = await getPage(`search=${encodeURIComponent(needle)}&limit=20`);
  return r.data.find((d) => d.pppoeUsername.trim().toLowerCase() === needle) ?? null;
}

export type RebootResult = { ok: true; message: string } | { ok: false; message: string };

// Perintah reboot modem sungguhan: dikirim server ke GenieACS (butuh izin cpe:manage).
export async function rebootCpeLive(customerId: string): Promise<RebootResult> {
  let res: Response;
  try {
    res = await fetch("/api/cpe/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId, action: "reboot_device" }),
    });
  } catch {
    return { ok: false, message: "Server aplikasi tidak terjangkau. Perintah reboot tidak dikirim." };
  }
  if (res.status === 403) return { ok: false, message: "Akun Anda tidak punya izin me-reboot modem (butuh peran admin)." };
  if (res.status === 404) return { ok: false, message: "Pelanggan tidak ditemukan di database." };
  if (res.status === 201 || res.status === 202) {
    // Server menjawab 201 walau tugasnya gagal; hasil sebenarnya ada di isi jawaban.
    const json = (await res.json().catch(() => null)) as {
      data?: { status?: string; payload?: { errorReason?: string } };
    } | null;
    if (json?.data?.status === "success") {
      return { ok: true, message: "Perintah reboot diterima GenieACS. Modem mati sekitar 1-2 menit." };
    }
    return {
      ok: false,
      message: json?.data?.payload?.errorReason ?? "GenieACS tidak menerima perintah reboot.",
    };
  }
  return { ok: false, message: `Server gagal mengirim perintah reboot (HTTP ${res.status}).` };
}

// Reboot ONU lewat OLT (CLI onu-reboot): jalan keluar saat modem tidak bisa dijangkau GenieACS. Server memeriksa izin
// cpe:manage dan mencatat audit; backend hanya menerima nomor PON/ONU bilangan bulat.
export async function rebootOnuViaOlt(onu: { oltId: string; ponIndex: number; onuIndex: number }): Promise<RebootResult> {
  let res: Response;
  try {
    res = await fetch(`/api/olts/${encodeURIComponent(onu.oltId)}/onus/${onu.ponIndex}/${onu.onuIndex}/reboot`, { method: "POST" });
  } catch {
    return { ok: false, message: "Server aplikasi tidak terjangkau. Perintah reboot tidak dikirim." };
  }
  const body: { ok?: boolean; message?: string; error?: { message?: string } } | null = await res.json().catch(() => null);
  if (res.status === 403) return { ok: false, message: "Akun Anda tidak punya izin me-reboot perangkat (butuh peran admin)." };
  if (res.ok && body?.ok) return { ok: true, message: body.message ?? "Perintah reboot diterima OLT." };
  return { ok: false, message: body?.error?.message ?? `Perintah reboot gagal (HTTP ${res.status}).` };
}
