// NOC: konfigurasi penuh GenieACS. Provision ini menjaga SELURUH pohon parameter
// modem tersimpan di GenieACS (bukan hanya segelintir parameter), supaya halaman
// perangkat GenieACS dan aplikasi NOC punya data lengkap: WAN, LAN, Wi-Fi, host,
// optik, kesehatan, objek vendor.
//
// Dijalankan preset "noc-full" pada SETIAP sesi modem (inform). Pembatasan lewat
// Date.now(interval): GenieACS membulatkan waktu ke jendela per-modem, sehingga
// tiap bagian hanya benar-benar diambil dari modem sekali per jendela. Modem yang
// baru pertama kali lapor, atau habis bootstrap (preset "bootstrap" mengosongkan
// cache), belum punya datanya, jadi langsung diambil penuh pada sesi itu.

const daily = Date.now(86400000);
const now = Date.now();

// Cabang yang TIDAK boleh dibaca. Satu parameter yang dijawab modem dengan fault
// membatalkan seluruh pembacaan (GenieACS menandai sesi gagal dan mengulang dari
// awal), jadi cabangnya dilewati. Dijumpai di FD511GW: membaca
// InternetGatewayDevice.X_CMS_PrivateNode.voip_mivas -> fault 9002 "Internal error".
// Tambahkan nama cabang tingkat pertama di sini bila halaman Faults di GenieACS
// menunjukkan parameter lain yang selalu gagal.
const SKIP = ["X_CMS_PrivateNode"];

// Kedalaman 9 mencukupi TR-098 terdalam yang dijumpai (mis.
// WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.Stats.X): 1 tingkat untuk
// cabang + 8 tingkat di bawahnya.
const MAX_DEPTH_BELOW_BRANCH = 8;

// Seluruh pohon, cabang demi cabang. "path" menelusuri objek/instance
// (GetParameterNames), "value" membaca nilainya. Root yang tidak dipakai modem
// (TR-098 vs TR-181) tidak punya cabang, jadi tidak ada yang dibaca.
for (const root of ["InternetGatewayDevice", "Device"]) {
  // Parameter tingkat pertama (mis. DeviceSummary) sekaligus menemukan cabangnya.
  const branches = declare(root + ".*", { path: daily, value: daily });
  for (const branch of branches) {
    const name = branch.path.slice(root.length + 1);
    if (SKIP.indexOf(name) !== -1) continue;
    let path = branch.path;
    for (let depth = 1; depth <= MAX_DEPTH_BELOW_BRANCH; depth++) {
      path += ".*";
      declare(path, { path: daily, value: daily });
    }
  }
}

// Virtual parameter dihitung dengan jendela harian untuk full tree
declare("VirtualParameters.*", { value: daily });
