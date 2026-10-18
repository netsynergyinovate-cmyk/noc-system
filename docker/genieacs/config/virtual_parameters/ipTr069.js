// NOC virtual parameter. Hanya MEMBACA data yang sudah tersimpan di GenieACS
// (declare dengan {value: 1} memakai cache; modem baru ditanya bila belum pernah
// dibaca). Penyegaran berkala dilakukan preset "noc-full", bukan di sini, jadi
// membuka halaman Devices tidak membebani modem.

// Alamat IP yang dipakai GenieACS menjangkau modem (host dari ConnectionRequestURL).
let ip = "";
for (const p of declare("InternetGatewayDevice.ManagementServer.ConnectionRequestURL", {value: 1})) {
  const m = /^https?:\/\/([^:\/]+)/i.exec(String(p.value && p.value[0]));
  if (m) { ip = m[1]; break; }
}
return {writable: false, value: [ip, "xsd:string"]};
