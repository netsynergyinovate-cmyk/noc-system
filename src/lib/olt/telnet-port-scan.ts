import { lookup } from "node:dns/promises";
import { connect, isIP, isIPv4 } from "node:net";
import { stripTelnet } from "./hsgq-telnet";

// Port telnet OLT yang lazim dipakai (23 bawaan, sisanya hasil port-forward operator). Daftar tetap dan pendek:
// ini mencari port telnet OLT yang operator lupa, bukan pemindai port umum.
export const TELNET_CANDIDATE_PORTS = [
  23, 2323, 23023, 8023, 9023, 10023, 1023, 3023, 5023, 6023, 7023, 2222, 2223,
  1001, 1002, 1003, 1004, 1005, 1022,
] as const;

export interface TelnetPortScan {
  telnet: { port: number; banner: string }[];
  /** Port terbuka yang bukan telnet (mis. web OLT); berguna agar operator tahu port itu bukan yang dicari. */
  otherOpen: number[];
}

const LOGIN_RE = /(user ?name|login)\s*:/i;

type Probe =
  | { port: number; kind: "telnet"; banner: string }
  | { port: number; kind: "other" }
  | null;

// Hanya membaca: telnet mengirim negosiasi (IAC) atau prompt login sendiri begitu tersambung, jadi tidak ada
// satu byte pun yang dikirim ke perangkat.
function probe(host: string, port: number, timeoutMs: number): Promise<Probe> {
  const { promise, resolve } = Promise.withResolvers<Probe>();
  const sock = connect({ host, port });
  let open = false;
  let raw = Buffer.alloc(0);
  const finish = () => {
    clearTimeout(timer);
    sock.destroy();
    if (!open) return resolve(null);
    const { text } = stripTelnet(raw);
    const isTelnet = raw.includes(0xff) || LOGIN_RE.test(text);
    const banner =
      /^\s*(.*?\bOperating System)\s*$/im.exec(text)?.[1]?.trim() ?? "";
    resolve(
      isTelnet
        ? { port, kind: "telnet", banner: banner.slice(0, 80) }
        : { port, kind: "other" },
    );
  };
  const timer = setTimeout(finish, timeoutMs);
  sock.on("connect", () => {
    open = true;
  });
  sock.on("data", (d: Buffer) => {
    raw = Buffer.concat([raw, d]);
    if (
      raw.includes(0xff) ||
      LOGIN_RE.test(stripTelnet(raw).text) ||
      raw.length > 512
    )
      finish();
  });
  sock.on("error", () => {
    open = false;
    finish();
  });
  sock.on("close", finish);
  return promise;
}

export async function scanTelnetPorts(
  ip: string,
  opts: { ports?: readonly number[]; timeoutMs?: number } = {},
): Promise<TelnetPortScan> {
  const results = await Promise.all(
    (opts.ports ?? TELNET_CANDIDATE_PORTS).map((p) =>
      probe(ip, p, opts.timeoutMs ?? 4000),
    ),
  );
  const found = results.filter((r): r is NonNullable<Probe> => r !== null);
  return {
    telnet: found.flatMap((r) =>
      r.kind === "telnet" ? [{ port: r.port, banner: r.banner }] : [],
    ),
    otherOpen: found.filter((r) => r.kind === "other").map((r) => r.port),
  };
}

function ipv4Forbidden(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  // 0/8 tak ditentukan, 127/8 loopback, 169.254/16 link-local + metadata cloud, 224/4 multicast, 240/4 dicadangkan + broadcast.
  return a === 0 || a === 127 || (a === 169 && b === 254) || a >= 224;
}

/** Alamat yang tidak boleh dipindai. Jaringan privat (10.x, 192.168.x, 172.16/12) sengaja boleh: OLT lazim di sana. */
export function isForbiddenScanAddress(ip: string): boolean {
  if (isIPv4(ip)) return ipv4Forbidden(ip);
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return ipv4Forbidden(mapped[1]);
  // ::, ::1, fe80::/10 link-local, ff00::/8 multicast.
  return (
    v6 === "::" || v6 === "::1" || /^fe[89ab]/.test(v6) || v6.startsWith("ff")
  );
}

/** Satu kali resolusi DNS; port dipindai lewat IP hasilnya supaya nama host tidak bisa berubah di tengah jalan. */
export async function resolveScanTarget(host: string): Promise<string> {
  const ip = isIP(host) ? host : (await lookup(host)).address;
  if (isForbiddenScanAddress(ip))
    throw new Error(
      "Alamat ini tidak boleh dipindai (loopback, link-local, atau multicast).",
    );
  return ip;
}
