// NOC virtual parameter. Hanya MEMBACA data yang sudah tersimpan di GenieACS
// (declare dengan {value: 1} memakai cache; modem baru ditanya bila belum pernah
// dibaca). Penyegaran berkala dilakukan preset "noc-full", bukan di sini, jadi
// membuka halaman Devices tidak membebani modem.

// Nama PPPoE (nomor pelanggan): akun pada koneksi PPP pertama yang terisi.
let user = "";
for (const p of declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.Username", {value: 1})) {
  const v = p.value && p.value[0];
  if (v) { user = String(v); break; }
}
return {writable: false, value: [user, "xsd:string"]};
