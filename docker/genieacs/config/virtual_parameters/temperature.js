// NOC virtual parameter. Hanya MEMBACA data yang sudah tersimpan di GenieACS
// (declare dengan {value: 1} memakai cache; modem baru ditanya bila belum pernah
// dibaca). Penyegaran berkala dilakukan preset "noc-full", bukan di sini, jadi
// membuka halaman Devices tidak membebani modem.

// Suhu modul optik (derajat C). Utama: XponInterface.TransceiverTemperature.
// Cadangan: sensor "Optical Module", lalu nilai mentah EponInterfaceConfig (1/256 C).
let t = null;
for (const p of declare("InternetGatewayDevice.DeviceInfo.XponInterface.TransceiverTemperature", {value: 1})) {
  const f = parseFloat(String(p.value && p.value[0]));
  if (isFinite(f)) t = f;
}
if (t === null) {
  for (const s of declare("InternetGatewayDevice.DeviceInfo.TemperatureStatus.TemperatureSensor.*.Name", {value: 1})) {
    if (String(s.value && s.value[0]).indexOf("Optical") === -1) continue;
    const base = s.path.slice(0, s.path.length - ".Name".length);
    for (const v of declare(base + ".Value", {value: 1})) {
      const f = parseFloat(String(v.value && v.value[0]));
      if (isFinite(f)) t = f;
    }
  }
}
if (t === null) {
  for (const p of declare("InternetGatewayDevice.WANDevice.*.X_CT-COM_EponInterfaceConfig.TransceiverTemperature", {value: 1})) {
    const raw = Number(p.value && p.value[0]);
    if (isFinite(raw) && raw !== 0) t = raw / 256;
  }
}
// GenieACS hanya menerima xsd:int/unsignedInt/boolean/string/dateTime untuk virtual
// parameter (tanpa double), jadi desimal ditulis sebagai teks dua angka di belakang koma.
return {writable: false, value: [t === null ? "" : String(Math.round(t * 100) / 100), "xsd:string"]};
