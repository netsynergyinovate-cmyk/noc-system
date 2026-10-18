// NOC: kredensial connection request, supaya GenieACS bisa MEMBANGUNKAN modem seketika.
//
// Tanpa ini modem menolak connection request dengan HTTP 401 (modem melaporkan sandinya
// kosong, jadi GenieACS tidak punya sandi yang cocok). Akibatnya setiap perintah (ubah
// Wi-Fi, reboot, diagnostik) hanya antre sampai modem lapor sendiri (sampai 5 menit) dan
// NBI membalas 202 alih-alih menyelesaikannya.
//
// Cara standar GenieACS: username = ID perangkat; sandi acak yang SAMA setiap kali untuk
// perangkat itu (Math.random() diinisialisasi dengan ID perangkat); disetel sekali per hari.
// Hanya mengubah kredensial jalur ACS -> modem, bukan data atau layanan pelanggan.

const daily = Date.now(86400000);
const username = declare("DeviceID.ID", { value: 1 }).value[0];
const password = Math.trunc(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);

// Hanya root yang dipakai modem ini (TR-098 atau TR-181); menulis ke path yang tidak ada
// membuat modem menjawab fault.
for (const root of ["InternetGatewayDevice", "Device"]) {
  const u = root + ".ManagementServer.ConnectionRequestUsername";
  const p = root + ".ManagementServer.ConnectionRequestPassword";
  if (declare(u, { value: 1 }).value === undefined) continue;
  declare(u, { value: daily }, { value: username });
  declare(p, { value: daily }, { value: password });
}
