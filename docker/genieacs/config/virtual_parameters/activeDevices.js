// NOC virtual parameter. Hanya MEMBACA data yang sudah tersimpan di GenieACS
// (declare dengan {value: 1} memakai cache; modem baru ditanya bila belum pernah
// dibaca). Penyegaran berkala dilakukan preset "noc-full", bukan di sini, jadi
// membuka halaman Devices tidak membebani modem.

// Jumlah perangkat yang sedang terhubung ke modem.
// Wi-Fi: jumlah TotalAssociations semua SSID (FD511GW selalu melaporkan Hosts.Host.*.Active
// = false untuk klien Wi-Fi, jadi flag itu tidak dipercaya untuk Wi-Fi).
// Kabel: host non-802.11 yang Active = true.
let n = 0;
for (const p of declare("InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.TotalAssociations", {value: 1})) {
  const v = Number(p.value && p.value[0]);
  if (isFinite(v) && v > 0) n += v;
}
for (const a of declare("InternetGatewayDevice.LANDevice.*.Hosts.Host.*.Active", {value: 1})) {
  const on = a.value && a.value[0];
  if (!(on === true || on === "true" || on === 1 || on === "1")) continue;
  const base = a.path.slice(0, a.path.length - ".Active".length);
  let wifi = false;
  for (const t of declare(base + ".InterfaceType", {value: 1})) {
    wifi = String(t.value && t.value[0]).indexOf("802.11") !== -1;
  }
  if (!wifi) n++;
}
return {writable: false, value: [n, "xsd:int"]};
