// Ringkasan armada modem di GenieACS untuk tab Konfigurasi: ke ACS mana modem sebenarnya diarahkan, seberapa sering
// mereka inform, dan siapa yang masih melapor. Murni (tanpa alias) supaya bisa diuji dengan node --test.

export interface FleetDevice {
  isOnline: boolean;
  lastInformAt: number;
  acs?: {
    url: string;
    informEnabled: boolean;
    informIntervalSec: number | null;
  };
}

export interface FleetGroup {
  /** ACS URL di modem, apa adanya; "" = tidak dilaporkan. */
  url: string;
  count: number;
  reporting: number;
  /** null bila ACS yang seharusnya belum diatur. */
  matchesConfigured: boolean | null;
}

export interface FleetSummary {
  total: number;
  reporting: number;
  newestInformAt: number | null;
  groups: FleetGroup[];
  intervals: { sec: number | null; count: number }[];
  informOff: number;
  /** Temuan yang menjelaskan "tidak melapor", urut dari yang paling penting. */
  findings: string[];
}

/** host:port tanpa skema, path, dan huruf besar; port bawaan http/https dilengkapi. null bila bukan URL. */
export function acsEndpoint(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`);
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    return `${u.hostname.toLowerCase()}:${port}`;
  } catch {
    return null;
  }
}

export function summarizeFleet(
  devices: readonly FleetDevice[],
  configuredAcsUrl: string,
  nowSec: number,
): FleetSummary {
  const want = acsEndpoint(configuredAcsUrl);
  const byUrl = new Map<string, FleetGroup>();
  const intervals = new Map<number | null, number>();
  let reporting = 0;
  let informOff = 0;
  let newest: number | null = null;

  for (const d of devices) {
    if (d.isOnline) reporting++;
    if (d.lastInformAt > 0 && (newest === null || d.lastInformAt > newest))
      newest = d.lastInformAt;
    const url = d.acs?.url.trim() ?? "";
    const g = byUrl.get(url) ?? {
      url,
      count: 0,
      reporting: 0,
      matchesConfigured: want === null ? null : acsEndpoint(url) === want,
    };
    g.count++;
    if (d.isOnline) g.reporting++;
    byUrl.set(url, g);
    if (d.acs && !d.acs.informEnabled) informOff++;
    const sec = d.acs?.informIntervalSec ?? null;
    intervals.set(sec, (intervals.get(sec) ?? 0) + 1);
  }

  const groups = [...byUrl.values()].sort((a, b) => b.count - a.count);
  const findings: string[] = [];
  const elsewhere = groups.filter(
    (g) => g.matchesConfigured === false && g.url !== "",
  );
  const elsewhereCount = elsewhere.reduce((n, g) => n + g.count, 0);
  if (elsewhereCount > 0) {
    findings.push(
      `${elsewhereCount} modem diarahkan ke ACS lain (${elsewhere.map((g) => g.url).join(", ")}), bukan ke ACS yang diatur di sini. ` +
        "Kalau alamat itu bukan server ini (dan tidak diteruskan ke sini), inform mereka tidak sampai ke GenieACS ini, jadi tampil tidak melapor walau internetnya hidup.",
    );
  }
  if (devices.length > 0 && reporting === 0) {
    findings.push(
      newest === null
        ? "Belum ada modem yang pernah melapor ke GenieACS ini."
        : `Tidak ada modem yang melapor dalam 15 menit terakhir; inform terbaru ${Math.max(0, Math.floor((nowSec - newest) / 3600))} jam lalu.`,
    );
  }
  // Banyak modem berhenti melapor pada saat yang hampir sama: jalur ke server yang putus (router/NAT/VPN/firewall),
  // bukan modemnya satu per satu.
  if (newest !== null && reporting === 0 && devices.length >= 5) {
    const nearNewest = devices.filter(
      (d) => d.lastInformAt > 0 && newest - d.lastInformAt <= 600,
    ).length;
    if (nearNewest / devices.length >= 0.8) {
      findings.push(
        `${nearNewest} dari ${devices.length} modem berhenti melapor bersamaan (inform terakhir dalam rentang 10 menit). ` +
          "Pola ini menunjukkan jalur menuju GenieACS yang putus (NAT/forward di router, VPN, atau firewall pada jam itu), bukan kerusakan modem satu per satu.",
      );
    }
  }
  if (informOff > 0)
    findings.push(
      `${informOff} modem mematikan periodic inform, jadi hanya terlihat saat dihubungi atau di-reboot.`,
    );

  return {
    total: devices.length,
    reporting,
    newestInformAt: newest,
    groups,
    intervals: [...intervals.entries()]
      .map(([sec, count]) => ({ sec, count }))
      .sort((a, b) => b.count - a.count),
    informOff,
    findings,
  };
}
