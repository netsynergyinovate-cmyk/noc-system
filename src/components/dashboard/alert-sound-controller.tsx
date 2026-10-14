"use client";

import { useEffect } from "react";
import { useAlertStore } from "@/lib/dashboard/alert-store";
import {
  createAlertSoundTracker,
  soundKindFor,
} from "@/lib/dashboard/alert-sound";
import { soundEngine } from "@/lib/dashboard/sound-engine";

// Membunyikan gangguan baru, sekali untuk tiap alert yang baru muncul di daftar
// aktif. Dipasang sekali di layout aplikasi (bersama DashboardFeed), jadi bunyinya
// terdengar di halaman mana pun yang sedang dibuka. Tidak menampilkan apa pun.
//
// Aturannya (lihat alert-sound.ts): alert yang sudah ada saat halaman dibuka
// tidak dihitung baru; yang tetap aktif tidak berbunyi lagi; beberapa alert baru
// dalam satu pembaruan berbunyi sekali, dengan nada kritis bila ada yang kritis;
// dibisukan atau belum diizinkan browser berarti diam, tetapi alert itu tetap
// dicatat sudah terlihat.
export function AlertSoundController() {
  useEffect(() => {
    const tracker = createAlertSoundTracker();
    let previous = useAlertStore.getState().active;
    // Yang sudah ada sekarang adalah dasarnya, bukan gangguan baru.
    tracker.observe(previous);

    const unsubscribe = useAlertStore.subscribe((state) => {
      // Pesan yang tidak mengubah daftar aktif tidak perlu diperiksa.
      if (state.active === previous) return;
      previous = state.active;
      const fresh = tracker.observe(state.active);
      if (fresh.length > 0) soundEngine.play(soundKindFor(fresh));
    });

    // Browser menahan suara sampai pengguna berinteraksi dengan halaman: klik atau
    // tombol pertama membukanya, lalu pendengarnya dilepas. Memakai "click", bukan
    // "pointerdown": tombol suara berubah tampilan begitu terbuka, dan perubahan
    // tata letak di antara tekan dan lepas membuat klik pertama pada tautan lain
    // tidak pernah terkirim.
    const unlockEvents = ["click", "keydown"] as const;
    const release = () => {
      for (const event of unlockEvents)
        window.removeEventListener(event, unlock, true);
    };
    function unlock() {
      void soundEngine.unlock().then((unlocked) => {
        if (unlocked) release();
      });
    }
    for (const event of unlockEvents)
      window.addEventListener(event, unlock, true);

    return () => {
      unsubscribe();
      release();
    };
  }, []);
  return null;
}
