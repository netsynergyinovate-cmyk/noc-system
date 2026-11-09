// NOC virtual parameter. Hanya MEMBACA data yang sudah tersimpan di GenieACS
// (declare dengan {value: 1} memakai cache; modem baru ditanya bila belum pernah
// dibaca). Penyegaran berkala dilakukan preset "noc-full", bukan di sini, jadi
// membuka halaman Devices tidak membebani modem.

// Nomor seri ONT: DeviceInfo.SerialNumber; bila kosong, serial dari DeviceID.
let sn = "";
for (const p of declare("InternetGatewayDevice.DeviceInfo.SerialNumber", {
  value: 1,
})) {
  const v = p.value && p.value[0];
  if (v) {
    sn = String(v);
    break;
  }
}
if (!sn) {
  for (const p of declare("DeviceID.SerialNumber", { value: 1 })) {
    const v = p.value && p.value[0];
    if (v) {
      sn = String(v);
      break;
    }
  }
}
return { writable: false, value: [sn, "xsd:string"] };
