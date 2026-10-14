import {
  ALERT_HISTORY_SECONDS,
  mockActiveAlerts,
  mockResolvedAlerts,
  reconcileAlertLists,
  sortResolvedAlerts,
  type ActiveAlert,
  type AlertLists,
  type ResolvedAlert,
} from "./alerts";
import { currentHandled, type HandledMap } from "./handled-registry";

// PEMBARUAN ALERT LEWAT HUB. Daftar alert tidak lagi ditarik berkala oleh tiap
// halaman; hub mendorongnya lewat WebSocket yang sama dengan snapshot dan delta,
// dan semua halaman membaca satu store (alert-store.ts). Aturan pesan yang
// diasumsikan frontend (backend Go belum mengirimnya; pada fase frontend, yang
// berperan sebagai hub adalah createMockAlertHub di bawah, yang dipasang di
// dashboard-feed.tsx):
//
//   { "type": "alerts", "time": <detik epoch>,
//     "active": [ <ActiveAlert>... ], "ended": [ <ResolvedAlert>... ] }
//
//   - active adalah DAFTAR LENGKAP alert yang masih aktif, bukan selisih, seperti
//     pesan "incidents": diterapkan dua kali tidak berbahaya, dan pesan yang
//     terlewat tidak meninggalkan celah. Daftar aktif kecil (puluhan).
//   - ended memuat alert yang selesai SEJAK PESAN SEBELUMNYA, dalam bentuk
//     ResolvedAlert, untuk ditambahkan ke riwayat. Dikenali dari id, jadi alert
//     yang sama dua kali tidak menggandakan baris.
//   - Dikirim hanya saat ada yang berubah: alert baru, alert selesai, atau isi
//     alert aktif berubah (mis. sumber akar dan dampaknya). Tidak tiap detik.
//   - Riwayat awal TIDAK ikut pesan ini (bisa ratusan baris): diambil lewat REST
//     (GET /api/v1/alerts?status=resolved, lihat loadResolvedAlerts) saat
//     tersambung dan setelah sinkron ulang, bersama daftar aktif (loadAlertLists).
//   - Satu alert ada di tepat satu daftar: bila id yang sama ada di active dan di
//     riwayat, riwayat yang benar (reconcileAlertLists).

export interface AlertsMessage {
  active: ActiveAlert[];
  ended: ResolvedAlert[];
}

// Isi satu alert sebagai teks, untuk membandingkan "apakah berubah". Objek dibangun
// oleh kode yang sama dengan urutan kunci yang sama, jadi teksnya stabil untuk isi
// yang sama.
export const alertSignature = (alert: object) => JSON.stringify(alert);

export const listSignature = (alerts: readonly object[]) =>
  alerts.map(alertSignature).join("\n");

// Menggabungkan daftar baru ke daftar lama dengan berbagi objek: alert yang
// isinya sama tetap objek yang sama, sehingga komponen yang memoisasi tidak
// digambar ulang, dan daftar yang sama sekali tidak berubah dikembalikan sebagai
// objek lama itu sendiri. Urutan `next` yang dipakai.
export function mergeAlerts<T extends { id: string }>(
  previous: T[] | null,
  next: T[],
): T[] {
  if (previous === null) return next;
  const before = new Map(previous.map((alert) => [alert.id, alert]));
  let unchanged = previous.length === next.length;
  const merged = next.map((alert, index) => {
    const old = before.get(alert.id);
    const reused =
      old !== undefined && alertSignature(old) === alertSignature(alert)
        ? old
        : alert;
    if (reused !== previous[index]) unchanged = false;
    return reused;
  });
  return unchanged ? previous : merged;
}

// Menambahkan alert yang baru selesai ke riwayat (yang paling akhir selesai di
// atas). Yang idnya sudah ada diabaikan, jadi pesan yang diterapkan ulang tidak
// mengubah apa pun; bila tidak ada yang baru, daftar lama dikembalikan.
export function mergeEnded(
  resolved: ResolvedAlert[],
  ended: ResolvedAlert[],
): ResolvedAlert[] {
  const known = new Set(resolved.map((alert) => alert.id));
  const fresh: ResolvedAlert[] = [];
  for (const alert of ended) {
    if (known.has(alert.id)) continue;
    known.add(alert.id);
    fresh.push(alert);
  }
  return fresh.length === 0
    ? resolved
    : sortResolvedAlerts([...resolved, ...fresh]);
}

// Membuang dari riwayat yang selesainya sudah lewat jendela. Riwayat terurut dari
// yang paling akhir selesai, jadi yang kedaluwarsa ada di ujungnya; bila tidak ada,
// daftar lama dikembalikan.
export function pruneResolved(
  resolved: ResolvedAlert[],
  nowSec: number,
  windowSeconds = ALERT_HISTORY_SECONDS,
): ResolvedAlert[] {
  const cutoff = nowSec - windowSeconds;
  let keep = resolved.length;
  while (keep > 0 && resolved[keep - 1].endedAt <= cutoff) keep -= 1;
  return keep === resolved.length ? resolved : resolved.slice(0, keep);
}

// Keadaan yang dipegang store; fungsi di bawah murni, jadi diuji tanpa React.
export interface AlertState {
  // null sampai daftar pertama diterima.
  active: ActiveAlert[] | null;
  resolved: ResolvedAlert[] | null;
  // Detik epoch pesan terakhir yang diterapkan.
  updatedAt: number | null;
}

export const emptyAlertState: AlertState = {
  active: null,
  resolved: null,
  updatedAt: null,
};

// Daftar lengkap menggantikan yang lama (saat tersambung atau setelah sinkron
// ulang), dengan berbagi objek untuk yang tidak berubah.
export function snapshotState(
  previous: AlertState,
  lists: AlertLists,
  nowSec: number,
): AlertState {
  const resolved = pruneResolved(
    mergeAlerts(previous.resolved, sortResolvedAlerts(lists.resolved)),
    nowSec,
  );
  const { active } = reconcileAlertLists(lists.active, resolved);
  return {
    active: mergeAlerts(previous.active, active),
    resolved,
    updatedAt: nowSec,
  };
}

// Menerapkan pesan "alerts". Sebelum riwayat diterima, hanya daftar aktif yang
// dipakai: riwayat tidak dikarang dari alert yang selesai.
export function messageState(
  previous: AlertState,
  message: AlertsMessage,
  nowSec: number,
): AlertState {
  if (previous.resolved === null) {
    return {
      ...previous,
      active: mergeAlerts(previous.active, message.active),
      updatedAt: nowSec,
    };
  }
  const resolved = pruneResolved(
    mergeEnded(previous.resolved, message.ended),
    nowSec,
  );
  const { active } = reconcileAlertLists(message.active, resolved);
  return {
    active: mergeAlerts(previous.active, active),
    resolved,
    updatedAt: nowSec,
  };
}

// Menerapkan hasil "tandai ditangani" yang dijawab server: alert keluar dari daftar
// aktif dan masuk ke puncak riwayat dalam satu pembaruan, tidak tampil di keduanya
// dan tidak hilang di antaranya. Menerapkannya lagi, atau sesudah pesan hub yang
// memuat alert yang sama, tidak mengubah apa pun (keadaan lama dikembalikan).
// Sebelum riwayat diterima hanya daftar aktif yang dipakai, seperti messageState.
export function handledState(
  previous: AlertState,
  alert: ResolvedAlert,
  nowSec: number,
): AlertState {
  const active =
    previous.active !== null &&
    previous.active.some((candidate) => candidate.id === alert.id)
      ? previous.active.filter((candidate) => candidate.id !== alert.id)
      : previous.active;
  const resolved =
    previous.resolved === null
      ? null
      : pruneResolved(mergeEnded(previous.resolved, [alert]), nowSec);
  if (active === previous.active && resolved === previous.resolved) {
    return previous;
  }
  return { active, resolved, updatedAt: nowSec };
}

export interface AlertHub {
  // Daftar lengkap aktif dan riwayat; untuk saat tersambung atau sinkron ulang.
  snapshot(nowSec: number): AlertLists;
  // Pesan bila ada yang berubah sejak pemeriksaan terakhir, selain itu null
  // (tidak ada pesan yang perlu dikirim).
  changes(nowSec: number): AlertsMessage | null;
}

export interface AlertSource {
  active(nowSec: number): ActiveAlert[];
  resolved(nowSec: number, windowSeconds: number): ResolvedAlert[];
}

// Data tiruan, dengan alert yang sudah ditandai ditangani petugas (catatan server
// tiruan, handled-registry.ts) keluar dari daftar aktif dan masuk ke riwayat.
// `handled` dibaca tiap dipanggil, jadi penandaan dari tab lain ikut terlihat.
// Satu batas tiruan: "selesai sejak pesan sebelumnya" dihitung dari jendela waktu,
// jadi penandaan dari tab lain yang ditulis di detik yang sama SESUDAH pemeriksaan
// hub baru masuk ke riwayat tab ini pada sinkron ulang berikutnya (daftar aktifnya
// langsung benar). Tab yang menandai sendiri tidak terkena: jawaban servernya
// diterapkan lewat handledState. Backend sungguhan mengirim "ended" dari kejadian.
export function createMockAlertSource(handled: () => HandledMap): AlertSource {
  return {
    active: (nowSec) => mockActiveAlerts(nowSec, handled()),
    resolved: (nowSec, windowSeconds) =>
      mockResolvedAlerts(nowSec, windowSeconds, handled()),
  };
}

const mockSource = createMockAlertSource(currentHandled);

// Pengganti hub pada fase frontend: menghitung alert dari data tiruan dan hanya
// "mengirim" bila ada yang berubah. `source` bisa diganti untuk uji.
export function createMockAlertHub(source: AlertSource = mockSource): AlertHub {
  // Detik pemeriksaan terakhir dan isi daftar aktif yang terakhir dikirim.
  let checkedAt: number | null = null;
  let sent = "";
  return {
    snapshot(nowSec) {
      const active = source.active(nowSec);
      checkedAt = nowSec;
      sent = listSignature(active);
      return {
        active,
        resolved: source.resolved(nowSec, ALERT_HISTORY_SECONDS),
      };
    },
    changes(nowSec) {
      const active = source.active(nowSec);
      // Yang selesai di antara pemeriksaan terakhir (tidak ikut) dan sekarang
      // (ikut): (checkedAt, nowSec].
      const elapsed = checkedAt === null ? 0 : nowSec - checkedAt;
      const ended = elapsed > 0 ? source.resolved(nowSec, elapsed) : [];
      checkedAt = nowSec;
      const signature = listSignature(active);
      if (ended.length === 0 && signature === sent) return null;
      sent = signature;
      return { active, ended };
    },
  };
}
