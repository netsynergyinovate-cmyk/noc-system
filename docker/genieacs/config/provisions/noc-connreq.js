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
// Sandi deterministik berbasis ID perangkat (konsisten di setiap sesi inform, anti HTTP 401)
let seed = 7;
const strId = String(username);
for (let i = 0; i < strId.length; i++) {
  seed = (seed * 31 + strId.charCodeAt(i)) >>> 0;
}
const salt = "noc_system_v1";
for (let i = 0; i < salt.length; i++) {
  seed = (seed * 31 + salt.charCodeAt(i)) >>> 0;
}
const num = (seed * 1664525 + 1013904223) >>> 0;
const num2 = (num * 1664525 + 1013904223) >>> 0;
const password = num.toString(36) + num2.toString(36);

// Hanya root yang dipakai modem ini (TR-098 atau TR-181); menulis ke path yang tidak ada
// membuat modem menjawab fault.
for (const root of ["InternetGatewayDevice", "Device"]) {
  const u = root + ".ManagementServer.ConnectionRequestUsername";
  const p = root + ".ManagementServer.ConnectionRequestPassword";
  if (declare(u, { value: 1 }).value === undefined) continue;
  declare(u, { value: daily }, { value: username });
  declare(p, { value: daily }, { value: password });
}
