// NOC virtual parameter. Daftar perangkat terhubung (LAN & Wi-Fi).
// Mengembalikan JSON string array objek: [{ hostname, ip, mac, type }].
let result = [];
let hostNames = declare(
  "InternetGatewayDevice.LANDevice.*.Hosts.Host.*.HostName",
  { value: 1 },
);
let ipAddrs = declare(
  "InternetGatewayDevice.LANDevice.*.Hosts.Host.*.IPAddress",
  { value: 1 },
);
let macAddrs = declare(
  "InternetGatewayDevice.LANDevice.*.Hosts.Host.*.MACAddress",
  { value: 1 },
);
let activeFlags = declare(
  "InternetGatewayDevice.LANDevice.*.Hosts.Host.*.Active",
  { value: 1 },
);

if (hostNames && hostNames.path && hostNames.path.length > 0) {
  for (let i = 0; i < hostNames.path.length; i++) {
    let isActive =
      activeFlags.value &&
      (activeFlags.value[i] === true ||
        activeFlags.value[i] === "true" ||
        activeFlags.value[i] === 1 ||
        activeFlags.value[i] === "1");
    let ip = ipAddrs.value ? ipAddrs.value[i] : "";
    if (isActive && ip && ip !== "0.0.0.0") {
      result.push({
        hostname:
          (hostNames.value && hostNames.value[i]) || "Perangkat Terhubung",
        ip: String(ip),
        mac: (macAddrs.value && macAddrs.value[i]) || "",
        type: "LAN/Wi-Fi",
      });
    }
  }
}

// Cadangan TR-181
if (result.length === 0) {
  let dHostNames = declare("Device.Hosts.Host.*.HostName", { value: 1 });
  let dIpAddrs = declare("Device.Hosts.Host.*.IPAddress", { value: 1 });
  let dPhysAddrs = declare("Device.Hosts.Host.*.PhysAddress", { value: 1 });
  let dActiveFlags = declare("Device.Hosts.Host.*.Active", { value: 1 });

  if (dHostNames && dHostNames.path && dHostNames.path.length > 0) {
    for (let i = 0; i < dHostNames.path.length; i++) {
      let isActive =
        dActiveFlags.value &&
        (dActiveFlags.value[i] === true ||
          dActiveFlags.value[i] === "true" ||
          dActiveFlags.value[i] === 1 ||
          dActiveFlags.value[i] === "1");
      let ip = dIpAddrs.value ? dIpAddrs.value[i] : "";
      if (isActive && ip && ip !== "0.0.0.0") {
        result.push({
          hostname:
            (dHostNames.value && dHostNames.value[i]) || "Perangkat Terhubung",
          ip: String(ip),
          mac: (dPhysAddrs.value && dPhysAddrs.value[i]) || "",
          type: "LAN/Wi-Fi",
        });
      }
    }
  }
}

return {
  writable: false,
  value: [result.length > 0 ? JSON.stringify(result) : "", "xsd:string"],
};
