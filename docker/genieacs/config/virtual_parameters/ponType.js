// NOC virtual parameter. Hanya MEMBACA data yang sudah tersimpan di GenieACS
// (declare dengan {value: 1} memakai cache; modem baru ditanya bila belum pernah
// dibaca). Penyegaran berkala dilakukan preset "noc-full", bukan di sini, jadi
// membuka halaman Devices tidak membebani modem.

// Jenis PON: EPON atau GPON, dari antarmuka vendor yang ada di modem.
const ep = declare(
  "InternetGatewayDevice.WANDevice.*.X_CT-COM_EponInterfaceConfig.Status",
  { value: 1 },
);
const gp = declare(
  "InternetGatewayDevice.WANDevice.*.X_CT-COM_GponInterfaceConfig.Status",
  { value: 1 },
);
const cmccEp = declare(
  "InternetGatewayDevice.WANDevice.*.X_CMCC_EponInterfaceConfig.Status",
  { value: 1 },
);
const cmccGp = declare(
  "InternetGatewayDevice.WANDevice.*.X_CMCC_GponInterfaceConfig.Status",
  { value: 1 },
);
let kind = "";
for (const p of ep) {
  kind = "EPON";
  break;
}
if (!kind)
  for (const p of cmccEp) {
    kind = "EPON";
    break;
  }
if (!kind)
  for (const p of gp) {
    kind = "GPON";
    break;
  }
if (!kind)
  for (const p of cmccGp) {
    kind = "GPON";
    break;
  }
return { writable: false, value: [kind, "xsd:string"] };
