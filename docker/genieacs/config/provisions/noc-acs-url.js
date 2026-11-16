// NOC: menjaga ACS URL modem tetap ke alamat GenieACS jalur tetap
// (docs/noc/genieacs-acs-path.md). args[0] = URL CWMP, diisi di preset "noc-acs-url".
// Modem yang masih memakai alamat lama (lewat dst-nat sementara) dipindah sekali;
// sesudahnya hanya dicek ulang sekali sehari. Root yang tidak dipakai modem
// (TR-098 vs TR-181) tidak punya parameternya, jadi diabaikan GenieACS.
const url = args[0];
if (url) {
  const daily = Date.now(86400000);
  declare("InternetGatewayDevice.ManagementServer.URL", { value: daily }, { value: url });
  declare("Device.ManagementServer.URL", { value: daily }, { value: url });
}
