// Multi-vendor optical RX power parser (Huawei, ZTE, Nokia, CT-COM, CMCC, TR-181)
let dbm = null;

function parseRaw(val) {
  if (val === undefined || val === null) return null;
  const str = String(Array.isArray(val) ? val[0] : val).trim();
  const f = parseFloat(str);
  return isFinite(f) ? f : null;
}

function uWToDbm(uW) {
  return uW > 0 ? 10 * Math.log10(uW / 1000) : null;
}

const directPaths = [
  "InternetGatewayDevice.X_ALU_OntOpticalParam.RXPower",
  "InternetGatewayDevice.DeviceInfo.XponInterface.RXPower",
  "InternetGatewayDevice.WANDevice.*.X_HW_GponInterfaceConfig.RXPower",
  "InternetGatewayDevice.WANDevice.*.X_HW_EponInterfaceConfig.RXPower",
  "InternetGatewayDevice.WANDevice.*.X_ZTE-COM_GponInterfaceConfig.RXPower",
  "InternetGatewayDevice.WANDevice.*.X_ZTE-COM_EponInterfaceConfig.RXPower",
];

for (const path of directPaths) {
  if (dbm !== null) break;
  for (const p of declare(path, { value: 1 })) {
    const f = parseRaw(p.value);
    if (f !== null) {
      dbm = f;
      break;
    }
  }
}

const raw01uWPaths = [
  "InternetGatewayDevice.WANDevice.*.X_CT-COM_EponInterfaceConfig.RXPower",
  "InternetGatewayDevice.WANDevice.*.X_CT-COM_GponInterfaceConfig.RXPower",
  "InternetGatewayDevice.WANDevice.*.X_CMCC_EponInterfaceConfig.RXPower",
  "InternetGatewayDevice.WANDevice.*.X_CMCC_GponInterfaceConfig.RXPower",
];

for (const path of raw01uWPaths) {
  if (dbm !== null) break;
  for (const p of declare(path, { value: 1 })) {
    const raw = parseRaw(p.value);
    if (raw !== null && raw > 0) {
      dbm = 10 * Math.log10(raw * 0.0001);
      break;
    }
  }
}

if (dbm === null) {
  const tr181Paths = [
    "Device.Optical.Interface.1.OpticalSignalLevel",
    "Device.Optical.Interface.*.OpticalSignalLevel",
    "Device.Optical.Interface.1.RxPower",
    "Device.Optical.Interface.*.RxPower",
  ];
  for (const path of tr181Paths) {
    if (dbm !== null) break;
    for (const p of declare(path, { value: 1 })) {
      const raw = parseRaw(p.value);
      if (raw !== null) {
        if (Math.abs(raw) > 100) {
          dbm = raw * 0.001; // 0.001 dBm scale
        } else if (raw > 0 && raw < 10000) {
          dbm = uWToDbm(raw);
        } else {
          dbm = raw;
        }
        break;
      }
    }
  }
}

return {
  writable: false,
  value: [dbm === null ? "" : String(Math.round(dbm * 100) / 100), "xsd:string"],
};
