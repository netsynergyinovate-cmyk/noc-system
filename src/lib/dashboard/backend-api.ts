// Klien REST ke backend Go dari browser. Backend memeriksa tiket singkat yang
// diterbitkan Next.js (POST /api/realtime/ticket), bukan cookie sesi. Tiket
// dipakai ulang sampai hampir kedaluwarsa supaya tiap permintaan tidak
// menerbitkan tiket baru.

interface Ticket {
  token: string;
  expiresAt: number; // detik unix
  apiUrl: string;
}

// Sisa umur tiket yang masih dianggap layak dipakai.
const TICKET_MIN_REMAINING_SECONDS = 10;

export class BackendError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "BackendError";
  }
}

let cached: Ticket | null = null;
let inflight: Promise<Ticket> | null = null;

async function fetchTicket(): Promise<Ticket> {
  const res = await fetch("/api/realtime/ticket", { method: "POST" });
  if (!res.ok) {
    throw new BackendError(res.status, "Tiket backend tidak bisa diterbitkan.");
  }
  const json = (await res.json()) as { data?: Partial<Ticket> };
  const d = json.data;
  if (!d?.token || !d.apiUrl || typeof d.expiresAt !== "number") {
    throw new BackendError(502, "Jawaban tiket backend tidak lengkap.");
  }
  return { token: d.token, expiresAt: d.expiresAt, apiUrl: d.apiUrl };
}

async function getTicket(force = false, nowSec = Date.now() / 1000): Promise<Ticket> {
  if (!force && cached && cached.expiresAt - nowSec > TICKET_MIN_REMAINING_SECONDS) {
    return cached;
  }
  inflight ??= fetchTicket().finally(() => {
    inflight = null;
  });
  cached = await inflight;
  return cached;
}

// GET <backend>/api/v1/... dengan tiket; mengembalikan isi "data" jawabannya. Satu kali coba ulang bila ditolak 401
// (tiket kedaluwarsa di tengah jalan).
export async function backendGet<T>(
  path: string,
  params: Record<string, string | number> = {},
  signal?: AbortSignal,
): Promise<T> {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();

  const attempt = async (force: boolean) => {
    const ticket = await getTicket(force);
    const url = `${ticket.apiUrl}${path}${query ? `?${query}` : ""}`;
    return fetch(url, {
      headers: { Authorization: `Bearer ${ticket.token}`, Accept: "application/json" },
      signal,
    });
  };

  let res = await attempt(false);
  if (res.status === 401) res = await attempt(true);
  if (!res.ok) {
    throw new BackendError(res.status, `Backend menjawab HTTP ${res.status}.`);
  }
  // Semua jawaban REST backend dibungkus {"data": ...}; yang dikembalikan isinya.
  const json = (await res.json()) as { data?: T };
  if (json === null || typeof json !== "object" || !("data" in json)) {
    throw new BackendError(502, "Jawaban backend tidak berbentuk {data: ...}.");
  }
  return json.data as T;
}

// Untuk tes: kosongkan tiket yang tersimpan.
export function resetBackendTicket() {
  cached = null;
  inflight = null;
}
