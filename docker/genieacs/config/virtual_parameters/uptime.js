// NOC virtual parameter. Hanya MEMBACA data yang sudah tersimpan di GenieACS
// (declare dengan {value: 1} memakai cache; modem baru ditanya bila belum pernah
// dibaca). Penyegaran berkala dilakukan preset "noc-full", bukan di sini, jadi
// membuka halaman Devices tidak membebani modem.

// Lama modem menyala, "1d 09:36:41". Nilai mentah DeviceInfo.UpTime dalam detik.
let text = "";
for (const p of declare("InternetGatewayDevice.DeviceInfo.UpTime", {value: 1})) {
  const sec = Number(p.value && p.value[0]);
  if (!isFinite(sec) || sec < 0) continue;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const two = (x) => (x < 10 ? "0" : "") + x;
  text = d + "d " + two(h) + ":" + two(m) + ":" + two(s);
}
return {writable: false, value: [text, "xsd:string"]};
