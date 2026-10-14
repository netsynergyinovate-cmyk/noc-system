// Memetakan kegagalan masuk atau daftar ke pesan berbahasa Indonesia dan ke
// bidang yang diberi fokus sesudahnya. Modul murni (tanpa React dan tanpa kode
// server), supaya dipakai formulir dan bisa diuji langsung dari spesifikasi
// logika.
//
// Pesan dan fokus berasal dari satu klasifikasi, jadi keduanya tidak mungkin
// saling bertentangan. Pesan tidak pernah memakai teks dari server (berbahasa
// Inggris dan bisa berubah antarversi), hanya status HTTP dan kode galatnya.

export type AuthMode = "sign-in" | "sign-up";

// Yang diketahui formulir tentang kegagalan: jawaban galat dari server (status
// HTTP dan kode Better Auth, bila ada), atau permintaan yang tidak sampai ke
// server sama sekali (fetch melempar). `retryAfter` hanya berarti untuk 429:
// lama tunggu dalam detik yang dikirim server di header X-Retry-After, sudah
// dibersihkan lewat retryDelaySeconds (atau tidak ada bila header-nya tidak ada).
export type AuthFailure =
  | { kind: "response"; status?: number; code?: string; retryAfter?: number }
  | { kind: "network" };

// Bidang yang menerima fokus. "submit" adalah tombol kirim.
export type AuthFocusTarget = "email" | "password" | "submit";

type AuthFailureKind =
  | "network"
  | "server-error"
  | "rate-limited"
  | "banned"
  | "email-taken"
  | "bad-credentials"
  | "sign-up-failed";

// Kode galat Better Auth, dicek pada better-auth 1.7.3 (node_modules):
// - BANNED_USER (plugin admin, 403): dilempar saat sesi dibuat untuk akun yang
//   diblokir, yaitu sesudah kata sandi benar.
// - USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL (422): jawaban sign-up untuk email
//   yang sudah terdaftar.
// - USER_ALREADY_EXISTS: kode saudaranya di tabel kode dasar dan plugin admin.
//   Sign-up biasa tidak memakainya, tetapi artinya sama, jadi ikut ditangani.
// - INVALID_ORIGIN dan MISSING_OR_NULL_ORIGIN (403, pemeriksaan Origin): alamat
//   yang dipakai petugas tidak cocok dengan BETTER_AUTH_URL di server. Itu salah
//   pasang, bukan salah petugas.
const BANNED_CODES: ReadonlySet<string> = new Set(["BANNED_USER"]);
const SERVER_CODES: ReadonlySet<string> = new Set([
  "INVALID_ORIGIN",
  "MISSING_OR_NULL_ORIGIN",
]);
const EMAIL_TAKEN_CODES: ReadonlySet<string> = new Set([
  "USER_ALREADY_EXISTS",
  "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
]);

function classify(mode: AuthMode, failure: AuthFailure): AuthFailureKind {
  if (failure.kind === "network") return "network";
  if (failure.status === 429) return "rate-limited";
  const code = failure.code ?? "";
  // Galat server (5xx, mis. database mati) dan salah pasang alamat tidak ada
  // hubungannya dengan isian petugas dan tidak bergantung pada apakah email
  // terdaftar, jadi tidak membocorkan apa pun. Dikatakan apa adanya supaya
  // petugas tidak mengira kata sandinya yang salah ketika yang rusak servernya.
  if ((failure.status ?? 0) >= 500 || SERVER_CODES.has(code)) {
    return "server-error";
  }
  if (mode === "sign-in") {
    return BANNED_CODES.has(code) ? "banned" : "bad-credentials";
  }
  return EMAIL_TAKEN_CODES.has(code) ? "email-taken" : "sign-up-failed";
}

const messages: Record<AuthFailureKind, string> = {
  network: "Tidak bisa menghubungi server. Periksa koneksi lalu coba lagi.",
  "server-error":
    "Server sedang bermasalah. Coba lagi sebentar; bila berulang, hubungi admin NOC.",
  "rate-limited":
    "Terlalu banyak percobaan. Tunggu beberapa detik lalu coba lagi.",
  banned: "Akun ini dinonaktifkan. Hubungi admin NOC.",
  "email-taken": "Email ini sudah terdaftar. Masuk, atau pakai email lain.",
  // Sengaja satu pesan untuk semua kegagalan masuk selain dua di atas (email
  // tidak dikenal, kata sandi salah, akun tanpa kata sandi, kode apa pun):
  // pesan yang berbeda akan membocorkan apakah sebuah email terdaftar.
  "bad-credentials": "Email atau kata sandi salah. Periksa lalu coba lagi.",
  "sign-up-failed": "Akun belum bisa dibuat. Periksa isian lalu coba lagi.",
};

// Hanya dua kegagalan yang menunjuk satu isian: pesan "email atau kata sandi
// salah" (orang tinggal mengetik ulang kata sandi) dan email yang sudah
// terdaftar (orang perlu email lain). Kegagalan lain tidak disebabkan isian
// tertentu: jaringan, batas laju, akun diblokir, galat server. Fokus kembali
// ke tombol kirim yang baru ditekan, jadi Enter atau Spasi mencoba lagi dan
// Shift+Tab tetap mencapai isian. Pesannya sendiri sudah diumumkan lewat
// role="alert".
const focusTargets: Record<AuthFailureKind, AuthFocusTarget> = {
  "bad-credentials": "password",
  "email-taken": "email",
  network: "submit",
  "server-error": "submit",
  "rate-limited": "submit",
  banned: "submit",
  "sign-up-failed": "submit",
};

export function authFailureMessage(mode: AuthMode, failure: AuthFailure) {
  return messages[classify(mode, failure)];
}

export function authFailureFocus(
  mode: AuthMode,
  failure: AuthFailure,
): AuthFocusTarget {
  return focusTargets[classify(mode, failure)];
}

// Lama tunggu bawaan (detik) bila server tidak menyebutkannya atau yang
// disebutkan tidak masuk akal. Sama dengan jendela batas laju Better Auth untuk
// jalur masuk dan daftar (10 detik).
export const DEFAULT_RETRY_SECONDS = 10;
// Batas atas: hitung mundur yang lebih lama dari semenit lebih mungkin salah
// baca (atau header ngawur) daripada benar, dan tombol tidak boleh terkunci
// berlama-lama.
export const MAX_RETRY_SECONDS = 60;

// Membersihkan nilai header X-Retry-After (atau apa pun yang diberikan) menjadi
// bilangan bulat detik 1..60. Bilangan bulat di rentang itu dipakai apa adanya,
// yang lebih besar dibatasi 60, pecahan dibulatkan ke atas (menunggu sedikit
// lebih lama lebih aman daripada mencoba terlalu cepat), teks angka ("7")
// diterima. Selain itu (null, undefined, NaN, nol, negatif, teks bukan angka,
// kosong, array, objek) memakai nilai bawaan. Hanya angka dan teks yang dibaca:
// [7] atau { toString } tidak dipaksa menjadi angka.
export function retryDelaySeconds(raw: unknown): number {
  let value: number;
  if (typeof raw === "number") value = raw;
  else if (typeof raw === "string") {
    // Header bisa berisi spasi di tepi. Number("") dan Number("  ") bernilai 0
    // (jatuh ke bawaan di bawah), Number("7abc") NaN.
    value = Number(raw.trim());
  } else return DEFAULT_RETRY_SECONDS;
  if (Number.isNaN(value) || value <= 0) return DEFAULT_RETRY_SECONDS;
  // Tak hingga ikut dibatasi ke 60: angka positif terlalu besar, bukan sampah.
  return Math.min(MAX_RETRY_SECONDS, Math.ceil(value));
}

// Berapa detik tombol kirim harus menunggu sesudah kegagalan ini. Hanya batas
// laju (429) yang menunggu: `retryAfter` bila server menyebutkannya, selain itu
// lama bawaan. Kegagalan lain null, jadi tombol tidak pernah terkunci karena
// salah kata sandi atau server mati.
export function authFailureWait(
  mode: AuthMode,
  failure: AuthFailure,
): number | null {
  if (classify(mode, failure) !== "rate-limited") return null;
  // classify hanya mengembalikan "rate-limited" untuk jawaban 429.
  const retryAfter =
    failure.kind === "response" ? failure.retryAfter : undefined;
  return retryAfter === undefined
    ? DEFAULT_RETRY_SECONDS
    : retryDelaySeconds(retryAfter);
}
