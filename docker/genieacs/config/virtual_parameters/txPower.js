// NOC virtual parameter. Hanya MEMBACA data yang sudah tersimpan di GenieACS
// (declare dengan {value: 1} memakai cache; modem baru ditanya bila belum pernah
// dibaca). Penyegaran berkala dilakukan preset "noc-full", bukan di sini, jadi
// membuka halaman Devices tidak membebani modem.

// Daya optik kirim (dBm).
// Utama: X_ALU_OntOpticalParam (CDTC) atau DeviceInfo.XponInterface.
// Cadangan: nilai mentah X_CT-COM_EponInterfaceConfig / GponInterfaceConfig dalam 0,1 uW.
let dbm = null;
for (const p of declare("InternetGatewayDevice.X_ALU_OntOpticalParam.TXPower", {
  value: 1,
})) {
  const f = parseFloat(String(p.value && p.value[0]));
  if (isFinite(f)) dbm = f;
}
if (dbm === null) {
  for (const p of declare(
    "InternetGatewayDevice.DeviceInfo.XponInterface.TXPower",
    { value: 1 },
  )) {
    const f = parseFloat(String(p.value && p.value[0]));
    if (isFinite(f)) dbm = f;
  }
}
if (dbm === null) {
  for (const p of declare(
    "InternetGatewayDevice.WANDevice.*.X_CT-COM_EponInterfaceConfig.TXPower",
    { value: 1 },
  )) {
    const raw = Number(p.value && p.value[0]);
    if (isFinite(raw) && raw > 0) dbm = 10 * Math.log10(raw * 0.0001);
  }
}
if (dbm === null) {
  for (const p of declare(
    "InternetGatewayDevice.WANDevice.*.X_CT-COM_GponInterfaceConfig.TXPower",
    { value: 1 },
  )) {
    const raw = Number(p.value && p.value[0]);
    if (isFinite(raw) && raw > 0) dbm = 10 * Math.log10(raw * 0.0001);
  }
}
if (dbm === null) {
  for (const p of declare(
    "InternetGatewayDevice.WANDevice.*.X_CMCC_EponInterfaceConfig.TXPower",
    { value: 1 },
  )) {
    const raw = Number(p.value && p.value[0]);
    if (isFinite(raw) && raw > 0) dbm = 10 * Math.log10(raw * 0.0001);
  }
}
if (dbm === null) {
  for (const p of declare(
    "InternetGatewayDevice.WANDevice.*.X_CMCC_GponInterfaceConfig.TXPower",
    { value: 1 },
  )) {
    const raw = Number(p.value && p.value[0]);
    if (isFinite(raw) && raw > 0) dbm = 10 * Math.log10(raw * 0.0001);
  }
}
// GenieACS hanya menerima xsd:int/unsignedInt/boolean/string/dateTime untuk virtual
// parameter (tanpa double), jadi desimal ditulis sebagai teks dua angka di belakang koma.
return {
  writable: false,
  value: [
    dbm === null ? "" : String(Math.round(dbm * 100) / 100),
    "xsd:string",
  ],
};
