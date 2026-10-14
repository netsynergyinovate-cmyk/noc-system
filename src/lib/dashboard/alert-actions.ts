import {
  ALERT_HISTORY_SECONDS,
  mockActiveAlerts,
  mockResolvedAlerts,
  type ResolvedAlert,
} from "./alerts";
import { handledRegistry, type HandledRegistry } from "./handled-registry";

// TINDAKAN PETUGAS PADA ALERT. Sekarang hanya satu: menandai alert aktif sudah
// ditangani. Titik ganti ke backend: handleAlert di bawah ->
//
//   POST /api/v1/alerts/{id}/handle     (tanpa isi; Origin diperiksa)
//
//   200 { "data": <ResolvedAlert> }     alert sudah ditandai; bentuknya sama dengan
//                                       baris riwayat, endTimeSource "operator"
//   401                                 belum masuk
//   409 { "error": "not_active" }       alert sudah tidak aktif: selesai sendiri,
//                                       atau sudah ditandai petugas lain
//
// Siapa yang menandai dan kapan diambil SERVER dari sesi login dan jamnya sendiri;
// frontend tidak mengirim nama atau waktu. (Server tiruan di bawah tidak punya
// sesi, jadi namanya dititipkan sebagai argumen.) Jawabannya dipakai langsung oleh
// store (handledState), dan hub yang sama mengirim hasilnya lagi lewat pesan
// "alerts": menerapkan keduanya tidak berbahaya.

export type HandleAlertFailure =
  // Server tidak terjangkau; belum ada yang berubah, boleh dicoba lagi.
  | "offline"
  // Alert sudah tidak aktif; tidak ada yang perlu ditandai.
  | "not-active";

export type HandleAlertResult =
  | { ok: true; alert: ResolvedAlert }
  | { ok: false; reason: HandleAlertFailure; message: string };

export interface AlertActions {
  handle(alertId: string, operator: string): Promise<HandleAlertResult>;
}

export const handleFailureMessages: Record<HandleAlertFailure, string> = {
  offline:
    "Tidak ada koneksi ke server, jadi alert belum ditandai. Coba lagi setelah tersambung.",
  "not-active":
    "Alert ini sudah tidak aktif: selesai sendiri atau sudah ditandai petugas lain. Lihat di riwayat alert selesai.",
};

export interface MockAlertActionsOptions {
  registry?: HandledRegistry;
  // Detik epoch sekarang menurut "server".
  now?: () => number;
  // Salah bila permintaan tidak akan sampai ke server.
  isOnline?: () => boolean;
  // Lama permintaan sampai dijawab, supaya keadaan "menyimpan" terlihat.
  latencyMs?: number;
  wait?: (ms: number) => Promise<void>;
}

// Lama jawaban server tiruan: cukup terasa, cukup singkat untuk tidak mengganggu.
export const MOCK_LATENCY_MS = 300;

// Server tiruan untuk fase frontend. Menjawab seperti backend sungguhan: periksa
// dulu apakah alertnya masih aktif pada saat permintaan DIPROSES (bukan saat tombol
// ditekan, bisa berbeda beberapa detik), catat siapa dan kapan, lalu jawab dengan
// baris riwayat yang sama dengan yang nanti dikirim hub dan REST.
export function createMockAlertActions({
  registry = handledRegistry,
  now = () => Math.floor(Date.now() / 1000),
  isOnline = () => typeof navigator === "undefined" || navigator.onLine,
  latencyMs = MOCK_LATENCY_MS,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: MockAlertActionsOptions = {}): AlertActions {
  const failure = (reason: HandleAlertFailure): HandleAlertResult => ({
    ok: false,
    reason,
    message: handleFailureMessages[reason],
  });
  return {
    async handle(alertId, operator) {
      // Permintaan yang tidak sampai tidak mengubah apa pun.
      if (!isOnline()) return failure("offline");
      if (latencyMs > 0) await wait(latencyMs);
      const nowSec = now();
      const stillActive = mockActiveAlerts(nowSec, registry.all()).some(
        (alert) => alert.id === alertId,
      );
      if (!stillActive) return failure("not-active");
      registry.add({
        id: alertId,
        at: nowSec,
        by: operator.trim() || "Petugas",
      });
      const alert = mockResolvedAlerts(
        nowSec,
        ALERT_HISTORY_SECONDS,
        registry.all(),
      ).find((candidate) => candidate.id === alertId);
      // Tak mungkin terjadi: baru saja dicatat. Dijawab seperti alert yang sudah
      // lewat, bukan sebagai keberhasilan tanpa isi.
      return alert ? { ok: true, alert } : failure("not-active");
    },
  };
}

// Satu server tiruan untuk seluruh halaman.
export const alertActions = createMockAlertActions();
