import { mockActiveAlerts } from "./alerts";
import { currentHandled } from "./handled-registry";
import { buildIncidentCards, type IncidentCard } from "./incident-cards";

// PEMBARUAN KARTU INSIDEN LEWAT HUB. Kartu insiden tidak lagi ditarik berkala;
// hub mendorongnya sebagai pesan "incidents" lewat WebSocket yang sama dengan
// snapshot dan delta. Aturan pesan yang diasumsikan frontend (backend Go belum
// mengirimnya; pada fase frontend, yang berperan sebagai hub adalah feed tiruan
// di dashboard-feed.tsx):
//
//   { "type": "incidents", "time": <detik epoch>, "cards": [ <IncidentCard>... ] }
//
//   - cards adalah DAFTAR LENGKAP kartu aktif, bukan selisih. Pesan yang
//     diterapkan dua kali tidak berbahaya, dan tidak ada celah yang perlu
//     ditambal bila ada pesan yang terlewat. Daftar kartu aktif kecil (puluhan),
//     jadi mengirim seluruhnya murah.
//   - Dikirim sekali tepat setelah "snapshot" (saat tersambung dan setelah
//     sinkron ulang), lalu hanya saat isi daftar berubah: alert baru, alert
//     selesai, anggota kelompok bertambah, atau akar dan dampaknya berubah.
//     Tidak dikirim tiap detik.
//   - Daftar kosong tetap pesan yang sah: artinya tidak ada insiden aktif.
//   - Urutan kartu dan isinya sama dengan IncidentCard (incident-cards.ts).

// Isi satu kartu sebagai teks, untuk membandingkan "apakah berubah". Objek
// dibangun oleh kode yang sama dengan urutan kunci yang sama, jadi teksnya
// stabil untuk isi yang sama.
export function cardSignature(card: IncidentCard) {
  return JSON.stringify(card);
}

export function listSignature(cards: IncidentCard[]) {
  return cards.map(cardSignature).join("\n");
}

// Menggabungkan daftar baru ke daftar lama dengan berbagi objek: kartu yang
// isinya sama tetap objek yang sama, sehingga komponen yang memoisasi tidak
// digambar ulang, dan daftar yang sama sekali tidak berubah dikembalikan
// sebagai objek lama itu sendiri.
export function mergeIncidentCards(
  previous: IncidentCard[] | null,
  next: IncidentCard[],
): IncidentCard[] {
  if (previous === null) return next;
  const before = new Map(previous.map((card) => [card.id, card]));
  let unchanged = previous.length === next.length;
  const merged = next.map((card, index) => {
    const old = before.get(card.id);
    const reused =
      old !== undefined && cardSignature(old) === cardSignature(card)
        ? old
        : card;
    if (reused !== previous[index]) unchanged = false;
    return reused;
  });
  return unchanged ? previous : merged;
}

export interface IncidentHub {
  // Daftar lengkap kartu aktif; untuk saat tersambung atau setelah sinkron ulang.
  snapshot(nowSec: number): IncidentCard[];
  // Daftar lengkap bila isinya berubah sejak yang terakhir dikirim, selain itu
  // null (tidak ada pesan yang perlu dikirim).
  changes(nowSec: number): IncidentCard[] | null;
}

// Pengganti hub pada fase frontend: menghitung kartu dari alert aktif tiruan dan
// hanya "mengirim" bila hasilnya berubah. Alert yang sudah ditandai ditangani
// petugas tidak lagi aktif, jadi tidak ikut kelompok mana pun (kartu menyusut atau
// hilang). `build` bisa diganti untuk uji.
export function createMockIncidentHub(
  build: (nowSec: number) => IncidentCard[] = (nowSec) =>
    buildIncidentCards(mockActiveAlerts(nowSec, currentHandled())),
): IncidentHub {
  let sent: string | null = null;
  return {
    snapshot(nowSec) {
      const cards = build(nowSec);
      sent = listSignature(cards);
      return cards;
    },
    changes(nowSec) {
      const cards = build(nowSec);
      const signature = listSignature(cards);
      if (signature === sent) return null;
      sent = signature;
      return cards;
    },
  };
}
