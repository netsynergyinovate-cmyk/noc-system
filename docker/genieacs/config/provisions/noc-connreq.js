const deviceId = declare("DeviceID.ID").value[0];
const connUser = "noc_acs";
const connPass = "CPE_" + deviceId.slice(-6) + "_NOC_SECRET_2026";
declare(
  "InternetGatewayDevice.ManagementServer.ConnectionRequestUsername",
  { value: Date.now() },
  { value: connUser },
);
declare(
  "InternetGatewayDevice.ManagementServer.ConnectionRequestPassword",
  { value: Date.now() },
  { value: connPass },
);
declare(
  "Device.ManagementServer.ConnectionRequestUsername",
  { value: Date.now() },
  { value: connUser },
);
declare(
  "Device.ManagementServer.ConnectionRequestPassword",
  { value: Date.now() },
  { value: connPass },
);
declare(
  "InternetGatewayDevice.ManagementServer.PeriodicInformEnable",
  { value: Date.now() },
  { value: true },
);
declare(
  "InternetGatewayDevice.ManagementServer.PeriodicInformInterval",
  { value: Date.now() },
  { value: 300 },
);
declare(
  "Device.ManagementServer.PeriodicInformEnable",
  { value: Date.now() },
  { value: true },
);
declare(
  "Device.ManagementServer.PeriodicInformInterval",
  { value: Date.now() },
  { value: 300 },
);
