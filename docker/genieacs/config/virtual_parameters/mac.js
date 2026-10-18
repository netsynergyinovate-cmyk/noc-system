// NOC virtual parameter. Hanya MEMBACA data yang sudah tersimpan di GenieACS
// (declare dengan {value: 1} memakai cache; modem baru ditanya bila belum pernah
// dibaca). Penyegaran berkala dilakukan preset "noc-full", bukan di sini, jadi
// membuka halaman Devices tidak membebani modem.

// Alamat MAC modem: antarmuka LAN pertama; bila tak ada, MAC koneksi WAN pertama.
let mac = "";
for (const p of declare("InternetGatewayDevice.LANDevice.*.LANEthernetInterfaceConfig.1.MACAddress", {value: 1})) {
  const v = p.value && p.value[0];
  if (v) { mac = String(v).toLowerCase(); break; }
}
if (!mac) {
  for (const p of declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.MACAddress", {value: 1})) {
    const v = p.value && p.value[0];
    if (v) { mac = String(v).toLowerCase(); break; }
  }
}
return {writable: false, value: [mac, "xsd:string"]};
