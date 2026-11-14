import { existsSync } from "node:fs";
import net from "node:net";

// Alamat sumber yang dipakai SERVER ini untuk menyambung ke host:port (socket.localAddress).
// Juga dipakai sebagai uji "port terbuka". BUKAN alamat yang dilihat router bila ada NAT/Docker:
// untuk saran allow-list pakai routerSourceIp.
// Hanya dipanggil untuk target yang sama dengan yang baru saja diuji (sudah lolos sanitasi host).
export function outboundSourceIp(
  host: string,
  port: number,
  timeoutMs = 2000,
): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const socket = net.connect({ host, port });
  const done = (value: string | null) => {
    socket.destroy();
    resolve(value);
  };
  socket.setTimeout(timeoutMs, () => done(null));
  socket.once("connect", () => done(socket.localAddress ?? null));
  socket.once("error", () => done(null));
  return promise;
}

export async function publicIp(): Promise<string | null> {
  try {
    const res = await fetch("https://api.ipify.org", {
      signal: AbortSignal.timeout(3000),
    });
    const text = (await res.text()).trim();
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(text) ? text : null;
  } catch {
    return null;
  }
}

// Di container Docker/Podman socket.localAddress = IP container (mis. 10.0.x.x Coolify); router tidak pernah melihatnya.
export const inContainer =
  existsSync("/.dockerenv") || existsSync("/run/.containerenv");

const privateNets = new net.BlockList();
for (const [a, p] of [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["100.64.0.0", 10], // CGNAT/VPN: tidak lewat NAT publik
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
] as const)
  privateNets.addSubnet(a, p, "ipv4");
privateNets.addSubnet("fc00::", 7, "ipv6");
privateNets.addSubnet("fe80::", 10, "ipv6");
privateNets.addAddress("::1", "ipv6");

export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  const v = net.isIP(h);
  return v !== 0 && privateNets.check(h, v === 4 ? "ipv4" : "ipv6");
}

// Aturan sama dengan Go netsource.SourceIP: router publik/hostname melihat IP publik (NAT);
// router privat melihat alamat lokal, kecuali di container (alamatnya tidak diketahui -> null, jangan menebak).
export function pickRouterSourceIp(o: {
  host: string;
  local: string | null;
  publicIp: string | null;
  inContainer: boolean;
}): string | null {
  if (!isPrivateHost(o.host))
    return o.publicIp ?? (o.inContainer ? null : o.local);
  return o.inContainer ? null : o.local;
}

// Perkiraan alamat server yang dilihat router (belum terverifikasi; NAT lain di jalur tetap mungkin).
export async function routerSourceIp(
  host: string,
  port: number,
): Promise<string | null> {
  const isPublic = !isPrivateHost(host);
  const [local, pub] = await Promise.all([
    inContainer ? null : outboundSourceIp(host, port),
    isPublic ? publicIp() : null,
  ]);
  return pickRouterSourceIp({ host, local, publicIp: pub, inContainer });
}

// Pesan untuk timeout HTTP yang TCP-nya berhasil tersambung (alamat sumber diketahui): port itu hidup tetapi tidak
// berbicara REST. Dibuat hati-hati: router yang sangat lambat juga bisa menghasilkan ini.
export function tcpConnectedTimeoutMessage(host: string, port: number): string {
  return `Port ${port} di ${host} tersambung tetapi tidak menjawab sebagai layanan REST dalam batas waktu: kemungkinan itu Winbox, API, atau layanan lain (atau router sangat lambat). Isi port layanan www/www-ssl dari /ip service print.`;
}
