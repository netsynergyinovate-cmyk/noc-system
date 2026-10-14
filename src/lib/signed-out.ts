// Keluar dari akun: ke mana petugas diarahkan, dan bagaimana tab lain diberi
// tahu. MURNI: tanpa React dan tanpa kode server, jadi aman dipakai di halaman
// server (membaca ?keluar=), komponen klien, dan tes Node. BroadcastChannel
// dipakai lewat objek global dan selalu dijaga: bila tidak ada (peramban lama,
// Node tanpa global itu), semuanya diam saja, tidak melempar.
//
// Ini hanya urusan tampilan dan arah. Yang benar-benar mencabut sesi adalah
// authClient.signOut() di server; pesan kanal tidak membawa data apa pun dan
// tidak memberi akses ke apa pun.

// Nama dan nilai parameter alamat. Hanya BENDERA: isinya tidak pernah ditampilkan.
export const SIGNED_OUT_PARAM = "keluar";
export const SIGNED_OUT_PATH = `/sign-in?${SIGNED_OUT_PARAM}=1`;

// Benar hanya untuk teks persis "1". Array (?keluar=1&keluar=2), "true", "01",
// " 1", angka 1, null, dan undefined semuanya salah, jadi penegasan tidak bisa
// dipancing oleh alamat buatan selain bentuk yang memang dibuat tombol Keluar.
export function isSignedOutParam(value: unknown): boolean {
  return value === "1";
}

const CHANNEL_NAME = "noc-session";
const SIGNED_OUT_TYPE = "signed-out";

// Pesan yang sah: objek dengan SATU kunci, `type`, bernilai "signed-out".
// Kunci tambahan sengaja tidak diterima: pesan yang membawa muatan lain adalah
// pesan lain di kanal yang sama, dan membalasnya dengan membuang tab ke halaman
// masuk akan menjadi pengalihan yang tidak diminta siapa pun. Bila kelak ada
// versi pesan dengan bidang tambahan, ia harus dikenali dengan sengaja di sini.
function isSignedOutMessage(data: unknown): boolean {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return false;
  }
  const keys = Object.keys(data);
  return (
    keys.length === 1 &&
    keys[0] === "type" &&
    (data as { type: unknown }).type === SIGNED_OUT_TYPE
  );
}

// Memberi tahu tab lain (origin dan profil peramban yang sama) bahwa petugas
// keluar. Kanal dibuka baru, dipakai sekali, lalu ditutup: tab pengirim tidak
// menerima pesannya sendiri dan tidak ada kanal yang tertinggal. Pesan yang
// sudah dikirim tetap sampai ke penerima walau kanal pengirim langsung ditutup.
export function announceSignedOut(): void {
  if (typeof BroadcastChannel === "undefined") return;
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ type: SIGNED_OUT_TYPE });
  } catch {
    // Kanal tidak tersedia atau pesan tidak bisa dikirim: diam. Tab lain tetap
    // ditolak server pada permintaan berikutnya.
  } finally {
    try {
      channel?.close();
    } catch {
      // Sudah tertutup.
    }
  }
}

// Mendengarkan kanal yang sama. Hanya pesan berbentuk persis
// { type: "signed-out" } yang memanggil `onSignedOut`. Mengembalikan fungsi
// berhenti (menutup kanal); tanpa BroadcastChannel mengembalikan fungsi kosong.
export function listenForSignedOut(onSignedOut: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return () => {};
  }
  channel.onmessage = (event: MessageEvent) => {
    if (isSignedOutMessage(event.data)) onSignedOut();
  };
  return () => {
    channel.onmessage = null;
    try {
      channel.close();
    } catch {
      // Sudah tertutup.
    }
  };
}
