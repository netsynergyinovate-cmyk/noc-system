import dgram from "node:dgram";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";

// Membantu operator MENDAPATKAN alamat yang dibutuhkan saat menambah router, bukan menebaknya:
//  - alamat sumber server NOC ke host tertentu (untuk allow-list /ip service),
//  - kandidat alamat router: gateway server, tetangga ARP bermerek MikroTik, dan hasil pemindaian satu rentang
//    jaringan yang disebut operator (hanya alamat privat, maksimal /24).
// Semua pemeriksaan tanpa kredensial.

// Alamat sumber yang akan dipilih kernel untuk menuju host (socket UDP connect tidak mengirim paket apa pun).
export function sourceIpFor(
  host: string,
  port = 80,
  timeoutMs = 1500,
): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const socket = dgram.createSocket(net.isIPv6(host) ? "udp6" : "udp4");
  const done = (value: string | null) => {
    try {
      socket.close();
    } catch {
      // sudah tertutup
    }
    resolve(value);
  };
  const timer = setTimeout(() => done(null), timeoutMs);
  socket.once("error", () => {
    clearTimeout(timer);
    done(null);
  });
  socket.connect(port, host, () => {
    clearTimeout(timer);
    try {
      done(socket.address().address);
    } catch {
      done(null);
    }
  });
  return promise;
}

export function isPrivateIPv4(ip: string): boolean {
  if (!net.isIPv4(ip)) return false;
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

// /proc/net/route: alamat heksadesimal little-endian. Tujuan 00000000 = rute bawaan.
export function parseDefaultGateways(routeTable: string): string[] {
  const out: string[] = [];
  for (const line of routeTable.split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (
      f.length < 4 ||
      f[1] !== "00000000" ||
      !(Number.parseInt(f[3], 16) & 0x2)
    )
      continue;
    const gw = f[2];
    if (!/^[0-9A-Fa-f]{8}$/.test(gw) || gw === "00000000") continue;
    const ip = [6, 4, 2, 0]
      .map((i) => Number.parseInt(gw.slice(i, i + 2), 16))
      .join(".");
    if (!out.includes(ip)) out.push(ip);
  }
  return out;
}

// Awalan MAC (OUI) perangkat MikroTik/Routerboard yang umum. Hanya petunjuk: bukan bukti.
const MIKROTIK_OUI: Record<string, true> = {
  "00:0C:42": true,
  "18:FD:74": true,
  "2C:C8:1B": true,
  "48:8F:5A": true,
  "4C:5E:0C": true,
  "64:D1:54": true,
  "6C:3B:6B": true,
  "74:4D:28": true,
  "78:9A:18": true,
  "B8:69:F4": true,
  "C4:AD:34": true,
  "CC:2D:E0": true,
  "D4:CA:6D": true,
  "DC:2C:6E": true,
  "E4:8D:8C": true,
};

// /proc/net/arp: "IP address  HW type  Flags  HW address  Mask  Device".
export function parseMikrotikNeighbors(arpTable: string): string[] {
  const out: string[] = [];
  for (const line of arpTable.split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (
      f.length >= 4 &&
      net.isIPv4(f[0]) &&
      MIKROTIK_OUI[f[3].toUpperCase().slice(0, 8)]
    )
      out.push(f[0]);
  }
  return out;
}

// Daftar alamat dari "a.b.c.d/n" (n 24..32), tanpa alamat jaringan dan siaran. Hanya jaringan privat.
export function expandCidr(cidr: string): string[] {
  const m = cidr.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!m || !net.isIPv4(m[1]))
    throw new Error("Format rentang harus a.b.c.d/n, mis. 10.20.30.0/24.");
  const bits = Number(m[2]);
  if (bits < 24 || bits > 32)
    throw new Error("Rentang yang boleh dipindai: /24 sampai /32.");
  if (!isPrivateIPv4(m[1]))
    throw new Error("Hanya rentang jaringan privat yang boleh dipindai.");
  const base = m[1].split(".").map(Number);
  const start = base[3] & (256 - 2 ** (32 - bits));
  const size = 2 ** (32 - bits);
  const hosts: string[] = [];
  for (let i = start; i < start + size; i++) {
    if (size > 2 && (i === start || i === start + size - 1)) continue;
    hosts.push(`${base[0]}.${base[1]}.${base[2]}.${i}`);
  }
  return hosts;
}

// "reset": TCP tersambung lalu langsung diputus tanpa jawaban HTTP, ciri khas allow-list /ip service MikroTik yang
// belum memuat alamat server ini (router ada di sana tetapi belum mengizinkan kita).
export type RestProbe = {
  port: number;
  tls: boolean;
  status: 200 | 401 | "reset";
};

// Layanan REST MikroTik menjawab 401 (atau 200 JSON) pada /rest/system/resource tanpa kredensial. Untuk www-ssl
// sertifikat tidak diperiksa (hanya mengetahui layanan itu aktif; tidak ada kredensial yang dikirim).
export function probeRest(
  host: string,
  port: number,
  tls = false,
  timeoutMs = 1200,
): Promise<RestProbe | null> {
  const { promise, resolve } = Promise.withResolvers<RestProbe | null>();
  const req = (tls ? https : http).request(
    {
      host,
      port,
      path: "/rest/system/resource",
      method: "GET",
      timeout: timeoutMs,
      ...(tls && { rejectUnauthorized: false }),
    },
    (res) => {
      res.resume();
      const code = res.statusCode;
      const auth = String(res.headers["www-authenticate"] ?? "");
      const isJson = /json/i.test(String(res.headers["content-type"] ?? ""));
      resolve(
        (code === 200 && isJson) || (code === 401 && /basic/i.test(auth))
          ? { port, tls, status: code as 200 | 401 }
          : null,
      );
    },
  );
  req.once("timeout", () => {
    req.destroy();
    resolve(null);
  });
  req.once("error", (err: NodeJS.ErrnoException) => {
    resolve(
      err.code === "ECONNRESET" ||
        /socket hang up|other side closed/i.test(err.message)
        ? { port, tls, status: "reset" }
        : null,
    );
  });
  req.end();
  return promise;
}

export const REST_TARGETS = [
  { port: 80, tls: false },
  { port: 8081, tls: false },
  { port: 8080, tls: false },
  { port: 443, tls: true },
] as const;

export type RouterCandidate = {
  address: string;
  via: Array<"gateway" | "tetangga" | "pindai">;
  rest: RestProbe[];
};

async function pool<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

export async function discoverRouters(
  cidr?: string,
): Promise<{ candidates: RouterCandidate[]; scanned: number }> {
  const via = new Map<string, Set<RouterCandidate["via"][number]>>();
  const add = (ip: string, how: RouterCandidate["via"][number]) =>
    via.set(ip, (via.get(ip) ?? new Set()).add(how));
  if (process.platform === "linux") {
    try {
      for (const ip of parseDefaultGateways(
        fs.readFileSync("/proc/net/route", "utf-8"),
      ))
        add(ip, "gateway");
      for (const ip of parseMikrotikNeighbors(
        fs.readFileSync("/proc/net/arp", "utf-8"),
      ))
        add(ip, "tetangga");
    } catch {
      // bukan Linux biasa: lanjut dengan yang ada
    }
  }
  const range = cidr ? expandCidr(cidr) : [];
  for (const ip of range) add(ip, "pindai");
  const all = [...via.keys()];
  const probed = await pool(all, 48, async (ip) => {
    const rest = (
      await Promise.all(REST_TARGETS.map((t) => probeRest(ip, t.port, t.tls)))
    ).filter((r): r is RestProbe => r !== null);
    return {
      address: ip,
      via: [...(via.get(ip) ?? [])],
      rest,
    } satisfies RouterCandidate;
  });
  // Gateway/tetangga selalu ditampilkan (petunjuk); hasil pindaian hanya bila REST-nya hidup.
  const candidates = probed.filter(
    (c) => c.rest.length > 0 || c.via.some((v) => v !== "pindai"),
  );
  const rank = (c: RouterCandidate) =>
    c.rest.some((r) => r.status !== "reset") ? 2 : c.rest.length > 0 ? 1 : 0;
  candidates.sort((a, b) => rank(b) - rank(a));
  return { candidates, scanned: range.length };
}
