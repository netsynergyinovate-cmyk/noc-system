// Alamat ACS (CWMP) yang ditulis ke MODEM lewat "Pasang GenieACS lewat web ONT". Modem
// harus bisa mencapainya dari jaringan pelanggan, jadi bukan alamat internal server:
// nama layanan Docker (genieacs), localhost/loopback, atau port NBI/UI/FS GenieACS.
// Aturan yang sama ada di Go: backend/internal/ontweb/config.go (ValidateACSURL).
// Murni (tanpa alias path) agar bisa dipakai validator, komponen klien, dan node --test.

const NON_CWMP_PORTS: Record<string, string> = {
  "7557": "NBI (API)",
  "7558": "UI",
  "7567": "file server",
};

const FORMAT = "ACS URL harus http(s)://host:port tanpa nama pengguna";
const SELF =
  "menunjuk ke modem itu sendiri, bukan ke GenieACS; pakai IP server GenieACS yang terlihat dari jaringan pelanggan";

/** null = boleh dipasang ke modem; selain itu alasan penolakan (Bahasa Indonesia). */
export function acsUrlProblem(raw: string): string | null {
  const v = raw.trim();
  if (v.length > 256)
    return "ACS URL terlalu panjang (modem membatasi 256 karakter)";
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return FORMAT;
  }
  if (
    (u.protocol !== "http:" && u.protocol !== "https:") ||
    !u.hostname ||
    u.username ||
    u.password
  )
    return FORMAT;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
  const ipv6 = host.includes(":");
  if (
    (ipv4 && (host.startsWith("127.") || host === "0.0.0.0")) ||
    (ipv6 && (host === "::1" || host === "::")) ||
    host === "localhost" ||
    host.endsWith(".localhost")
  )
    return `ACS URL ${host} ${SELF}`;
  if (!ipv4 && !ipv6 && !host.includes("."))
    return `host "${host}" tanpa domain (mis. nama layanan Docker) tidak bisa di-resolve modem; pakai IP atau nama domain yang terlihat dari jaringan pelanggan, mis. http://172.16.0.1:7547`;
  const port = NON_CWMP_PORTS[u.port];
  if (port)
    return `port ${u.port} adalah ${port} GenieACS, bukan CWMP; modem harus ke port CWMP (biasanya 7547)`;
  return null;
}
