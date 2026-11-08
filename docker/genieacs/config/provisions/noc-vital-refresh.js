// NOC: refresh parameter vital ONT (Optik, LAN, Wi-Fi, IP) tanpa tree crawling berat.
const now = Date.now();

// Refresh parameter optik (multi-vendor leaf values)
declare("InternetGatewayDevice.WANDevice.*.X_CT-COM_GponInterfaceConfig.RXPower", {value: now});
declare("InternetGatewayDevice.WANDevice.*.X_CT-COM_GponInterfaceConfig.TXPower", {value: now});
declare("InternetGatewayDevice.WANDevice.*.X_CT-COM_GponInterfaceConfig.TransceiverTemperature", {value: now});
declare("InternetGatewayDevice.WANDevice.*.X_CT-COM_EponInterfaceConfig.RXPower", {value: now});
declare("InternetGatewayDevice.WANDevice.*.X_CT-COM_EponInterfaceConfig.TXPower", {value: now});
declare("InternetGatewayDevice.WANDevice.*.X_CT-COM_EponInterfaceConfig.TransceiverTemperature", {value: now});
declare("InternetGatewayDevice.DeviceInfo.XponInterface.RXPower", {value: now});
declare("InternetGatewayDevice.DeviceInfo.XponInterface.TXPower", {value: now});
declare("InternetGatewayDevice.DeviceInfo.XponInterface.TransceiverTemperature", {value: now});
declare("InternetGatewayDevice.X_ALU_OntOpticalParam.RXPower", {value: now});
declare("InternetGatewayDevice.X_ALU_OntOpticalParam.TXPower", {value: now});
declare("InternetGatewayDevice.X_ALU_OntOpticalParam.TransceiverTemperature", {value: now});
declare("Device.Optical.Interface.*.OpticalSignalLevel", {value: now});
declare("Device.Optical.Interface.*.TransmitOpticalLevel", {value: now});

// Refresh instance discovery klien LAN & Wi-Fi ({path: now})
declare("InternetGatewayDevice.LANDevice.*.Hosts.Host.*", {path: now});
declare("InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.AssociatedDevice.*", {path: now});
declare("Device.Hosts.Host.*", {path: now});
declare("Device.WiFi.AccessPoint.*.AssociatedDevice.*", {path: now});

// Refresh nilai klien LAN & Wi-Fi ({value: now})
declare("InternetGatewayDevice.LANDevice.*.Hosts.Host.*.HostName", {value: now});
declare("InternetGatewayDevice.LANDevice.*.Hosts.Host.*.IPAddress", {value: now});
declare("InternetGatewayDevice.LANDevice.*.Hosts.Host.*.MACAddress", {value: now});
declare("InternetGatewayDevice.LANDevice.*.Hosts.Host.*.Active", {value: now});
declare("InternetGatewayDevice.LANDevice.*.Hosts.Host.*.InterfaceType", {value: now});
declare("InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.AssociatedDevice.*.AssociatedDeviceMACAddress", {value: now});
declare("InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.TotalAssociations", {value: now});
declare("Device.Hosts.Host.*.HostName", {value: now});
declare("Device.Hosts.Host.*.IPAddress", {value: now});
declare("Device.Hosts.Host.*.PhysAddress", {value: now});
declare("Device.Hosts.Host.*.Active", {value: now});
declare("Device.Hosts.Host.*.InterfaceType", {value: now});
declare("Device.WiFi.AccessPoint.*.AssociatedDevice.*.AssociatedDeviceMACAddress", {value: now});

// Refresh kesehatan & uptime modem
declare("InternetGatewayDevice.DeviceInfo.UpTime", {value: now});
declare("InternetGatewayDevice.DeviceInfo.ProcessStatus.CPUUsage", {value: now});
declare("InternetGatewayDevice.DeviceInfo.MemoryStatus.*", {value: now});
declare("InternetGatewayDevice.DeviceInfo.TemperatureStatus.TemperatureSensor.*.*", {value: now});
declare("Device.DeviceInfo.UpTime", {value: now});
declare("Device.DeviceInfo.ProcessStatus.CPUUsage", {value: now});
declare("Device.DeviceInfo.MemoryStatus.*", {value: now});
declare("Device.DeviceInfo.TemperatureStatus.TemperatureSensor.*.*", {value: now});
// Refresh Wi-Fi SSID
declare("InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.SSID", {value: now});
declare("Device.WiFi.SSID.*.SSID", {value: now});

// Refresh IP WAN / PPPoE / TR-069 otomatis
declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.ExternalIPAddress", {value: now});
declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANIPConnection.*.ExternalIPAddress", {value: now});
declare("Device.PPP.Interface.*.IPCP.LocalIPAddress", {value: now});
declare("Device.IP.Interface.*.IPv4Address.*.IPAddress", {value: now});
declare("InternetGatewayDevice.ManagementServer.ConnectionRequestURL", {value: now});
declare("Device.ManagementServer.ConnectionRequestURL", {value: now});

// Refresh Virtual Parameters
declare("VirtualParameters.*", {value: now});
