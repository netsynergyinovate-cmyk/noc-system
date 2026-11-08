// NOC virtual parameter. Hanya MEMBACA data yang sudah tersimpan di GenieACS
// (declare dengan {value: 1} memakai cache; modem baru ditanya bila belum pernah
// dibaca). Penyegaran berkala dilakukan preset "noc-full", bukan di sini, jadi
// membuka halaman Devices tidak membebani modem.

// Alamat IP yang dipakai GenieACS menjangkau modem (host dari ConnectionRequestURL).
let ip = "";
for (const root of ["InternetGatewayDevice", "Device"]) {
  for (const p of declare(root + ".ManagementServer.ConnectionRequestURL", {value: 1})) {
    const m = /^https?:\/\/([^:\/]+)/i.exec(String(p.value && p.value[0]));
    if (m && m[1] && m[1] !== "0.0.0.0") { ip = m[1]; break; }
  }
  if (ip) break;
}
if (!ip) {
  for (const p of declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANIPConnection.*.ExternalIPAddress", {value: 1})) {
    const v = p.value && p.value[0];
    if (v && v !== "0.0.0.0") { ip = String(v); break; }
  }
}
if (!ip) {
  for (const p of declare("Device.IP.Interface.*.IPv4Address.*.IPAddress", {value: 1})) {
    const v = p.value && p.value[0];
    if (v && v !== "0.0.0.0" && !String(v).startsWith("127.")) { ip = String(v); break; }
  }
}
return {writable: false, value: [ip, "xsd:string"]};
