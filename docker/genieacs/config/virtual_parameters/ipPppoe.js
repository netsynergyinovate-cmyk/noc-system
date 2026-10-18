// NOC virtual parameter. Hanya MEMBACA data yang sudah tersimpan di GenieACS
// (declare dengan {value: 1} memakai cache; modem baru ditanya bila belum pernah
// dibaca). Penyegaran berkala dilakukan preset "noc-full", bukan di sini, jadi
// membuka halaman Devices tidak membebani modem.

// Alamat IP koneksi PPPoE (IP yang dipakai pelanggan ke internet).
let ip = "";
for (const p of declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.ExternalIPAddress", {value: 1})) {
  const v = p.value && p.value[0];
  if (v && v !== "0.0.0.0") { ip = String(v); break; }
}
if (!ip) {
  for (const p of declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANIPConnection.*.ExternalIPAddress", {value: 1})) {
    const v = p.value && p.value[0];
    if (v && v !== "0.0.0.0") { ip = String(v); break; }
  }
}
return {writable: false, value: [ip, "xsd:string"]};
