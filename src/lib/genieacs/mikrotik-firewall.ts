/**
 * Menghasilkan perintah RouterOS yang aman (terkunci ke IP server GenieACS dan IP ONT)
 * untuk mengizinkan HTTP Connection Request TR-069 seketika (Zero Delay) tanpa
 * membuka port 7547 ke publik/internet.
 */
export function formatMikrotikConnReqRule(options: {
  serverIp?: string;
  ontIp?: string;
  port?: number;
} = {}): string {
  const srv = options.serverIp?.trim() || "192.168.0.220";
  const dst = options.ontIp?.trim() ? ` dst-address=${options.ontIp.trim()}` : "";
  const p = options.port && options.port > 0 ? options.port : 7547;
  return `/ip firewall filter add chain=forward action=accept protocol=tcp src-address=${srv}${dst} dst-port=${p} comment="Izin TR-069 Connection Request (Hanya Server NOC)" place-before=0`;
}
