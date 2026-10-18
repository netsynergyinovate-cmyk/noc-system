// NOC virtual parameter. Hanya MEMBACA data yang sudah tersimpan di GenieACS
// (declare dengan {value: 1} memakai cache; modem baru ditanya bila belum pernah
// dibaca). Penyegaran berkala dilakukan preset "noc-full", bukan di sini, jadi
// membuka halaman Devices tidak membebani modem.

// SSID Wi-Fi utama (2,4 GHz): WLANConfiguration.1; bila tak ada, SSID pertama yang terisi.
let ssid = "";
for (const p of declare("InternetGatewayDevice.LANDevice.*.WLANConfiguration.1.SSID", {value: 1})) {
  const v = p.value && p.value[0];
  if (v) { ssid = String(v); break; }
}
if (!ssid) {
  for (const p of declare("InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.SSID", {value: 1})) {
    const v = p.value && p.value[0];
    if (v) { ssid = String(v); break; }
  }
}
return {writable: false, value: [ssid, "xsd:string"]};
