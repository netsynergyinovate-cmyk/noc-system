// Gabungan data langsung per pelanggan untuk tabel Pelanggan: modem (GenieACS), ONU (OLT), dan billing (RunsNet).
// Tanpa alias dan server-only supaya bisa diuji dengan node --test.

export interface CustomerLiveStatus {
  /** IP WAN modem dari GenieACS; bila belum terdaftar, IP sesi terakhir dari billing RunsNet. */
  ip: string | null;
  /** Uptime/perangkat dari modem; bila modem tidak sedang inform, ini bacaan terakhir (lihat modemOnline/informAt). */
  uptime: string | null;
  ssid: string | null;
  clients: number | null;
  /** Redaman RX (dBm): GenieACS bila modem terdaftar, kalau tidak dari OLT. */
  rxDbm: number | null;
  rxSource: "genieacs" | "olt" | null;
  /** ONU di OLT melaporkan LOS (kabel putus); beda dengan "tidak ada data". */
  onuLos: boolean;
  modemOnline: boolean;
  /** Detik epoch inform terakhir modem di GenieACS; null bila modem tidak terdaftar. */
  informAt: number | null;
  /** Label umur bacaan modem yang tidak sedang inform, mis. "per 7 jam lalu"; null bila bacaannya segar. */
  staleNote: string | null;
}

export interface LiveCustomerInput {
  id: string;
  pppoeUsername: string;
}
export interface LiveOnuInput {
  customerId: string;
  rxPower: number | null;
  status: string;
}
export interface LiveCpeInput {
  pppoeUsername: string;
  wanIp: string;
  uptimeText: string;
  isOnline: boolean;
  lastInformAt: number;
  wifi: { ssid: string; clientCount: number } | null;
  optical: { rxDbm: number | null };
}
export interface LiveBillingInput {
  custId: string;
  ipAddress: string | null;
}

const norm = (s: string) => s.trim().toLowerCase();
const clean = (s: string | null | undefined) => (s && s.trim() && s.trim() !== "—" ? s.trim() : null);

/** `17060001092@runsnet.id` -> `17060001092`; username lain apa adanya. */
const billingKey = (pppoe: string) => norm(pppoe).replace(/@runsnet\.id$/, "");

// 0 dBm dan NaN adalah nilai bawaan pemeta ("tidak dilaporkan"), bukan bacaan sungguhan.
const reported = (v: number | null | undefined) => (v != null && Number.isFinite(v) && v !== 0 ? v : null);

/** Umur bacaan untuk label redup, mis. "7 jam lalu". */
export function formatAgo(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return "baru saja";
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return `${Math.floor(s / 86400)} hari lalu`;
}

export function combineCustomerLive(
  customers: readonly LiveCustomerInput[],
  onus: readonly LiveOnuInput[],
  billing: readonly LiveBillingInput[],
  cpe: readonly LiveCpeInput[] | null,
  nowSec: number = Math.floor(Date.now() / 1000),
): Record<string, CustomerLiveStatus> {
  const cpeByUser = new Map((cpe ?? []).map((d) => [norm(d.pppoeUsername), d]));
  const onuByCustomer = new Map(onus.map((o) => [o.customerId, o]));
  const ipByBilling = new Map(billing.filter((b) => b.ipAddress).map((b) => [norm(b.custId), b.ipAddress as string]));

  const out: Record<string, CustomerLiveStatus> = {};
  for (const c of customers) {
    const device = cpeByUser.get(norm(c.pppoeUsername));
    const onu = onuByCustomer.get(c.id);
    const genieRx = device?.isOnline ? reported(device.optical.rxDbm) : null;
    const oltRx = onu && onu.status !== "los" ? reported(onu.rxPower) : null;
    const rxDbm = genieRx ?? oltRx;
    out[c.id] = {
      ip: clean(device?.wanIp) ?? ipByBilling.get(billingKey(c.pppoeUsername)) ?? null,
      uptime: clean(device?.uptimeText),
      ssid: clean(device?.wifi?.ssid),
      clients: device?.wifi ? device.wifi.clientCount : null,
      modemOnline: device?.isOnline ?? false,
      informAt: device && device.lastInformAt > 0 ? device.lastInformAt : null,
      staleNote: device && !device.isOnline && device.lastInformAt > 0 ? `per ${formatAgo(nowSec - device.lastInformAt)}` : null,
      rxDbm,
      rxSource: rxDbm === null ? null : genieRx !== null ? "genieacs" : "olt",
      onuLos: onu?.status === "los",
    };
  }
  return out;
}
