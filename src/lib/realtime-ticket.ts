import { createHmac } from "node:crypto";
import type { Permissions } from "./permissions";

// Tiket login singkat untuk backend Go (WebSocket /ws dan REST /api/v1/).
// Backend tidak tahu sesi Better Auth; ia hanya memeriksa tanda tangan tiket
// dengan rahasia yang sama. Format harus sama dengan backend/internal/auth:
//
//   base64url(payload) + "." + base64url(HMAC-SHA256(rahasia, payload))
//   payload = {"sub":"<id pengguna>","exp":<detik unix>,"perms":["alert:handle"]}
//             (base64url tanpa padding; "perms" hanya ada bila tidak kosong)
//
// Backend menolak tiket yang berlaku lebih dari 5 menit.
//
// `perms` adalah izin (bentuk "resource:aksi") yang dimiliki pemegang tiket
// untuk MENGUBAH data lewat backend Go. Tiket tanpa `perms` hanya boleh
// membaca. Karena `perms` ikut ditandatangani, klien tidak bisa menambahkannya
// sendiri. Peran dibaca saat tiket diterbitkan dan tiket berlaku 60 detik,
// jadi pencabutan peran di Next.js baru berlaku di backend Go paling lama 60
// detik kemudian (tiket yang sudah terbit tidak bisa ditarik).
//
// Berkas ini sengaja tanpa `server-only`, seperti auth-security.ts: ia murni
// (rahasia diberikan pemanggil) dan perlu bisa diuji langsung dari Node
// (e2e/permissions-write.spec.ts). Rahasianya sendiri hanya dibaca di
// src/app/api/realtime/ticket/route.ts lewat src/lib/env.ts yang server-only.
export const REALTIME_TICKET_TTL_SECONDS = 60;

// Izin yang dikenal backend Go, masing-masing dengan izin Better Auth yang
// menjadi dasarnya. Route tiket menanyakan Better Auth tentang peran ASLI akun
// untuk tiap baris dan hanya memasukkan yang diizinkan. Menambah baris di sini
// harus diikuti pemeriksaannya di backend Go (httpapi.requirePerm).
export const REALTIME_PERMS = {
  "alert:handle": { alert: ["handle"] },
} satisfies Record<string, Permissions>;

export type RealtimePerm = keyof typeof REALTIME_PERMS;

// "resource:aksi": huruf kecil, angka, "_" dan "-", tiap bagian diawali huruf.
const PERM_FORMAT = /^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/;

export function issueRealtimeTicket({
  userId,
  secret,
  perms = [],
  now = Date.now(),
  ttlSeconds = REALTIME_TICKET_TTL_SECONDS,
}: {
  userId: string;
  secret: string;
  perms?: readonly string[];
  now?: number;
  ttlSeconds?: number;
}) {
  for (const perm of perms) {
    if (!PERM_FORMAT.test(perm))
      throw new Error(`Bentuk izin tiket tidak sah: ${JSON.stringify(perm)}`);
  }
  const expiresAt = Math.floor(now / 1000) + ttlSeconds;
  // Diurutkan dan tanpa kembar: himpunan izin yang sama selalu menghasilkan
  // byte payload yang sama, apa pun urutan pemanggil. Kosong berarti tanpa
  // kunci "perms" sama sekali (tiket persis seperti sebelum ada izin).
  const sorted = [...new Set(perms)].sort();
  const payload = Buffer.from(
    JSON.stringify({
      sub: userId,
      exp: expiresAt,
      ...(sorted.length > 0 ? { perms: sorted } : {}),
    }),
  );
  const signature = createHmac("sha256", secret).update(payload).digest();
  return {
    token: `${payload.toString("base64url")}.${signature.toString("base64url")}`,
    expiresAt,
  };
}
