import type { ActiveAlert } from "./alerts";

// SUARA ALERT. Petugas NOC tidak selalu menatap layar, jadi gangguan baru harus
// terdengar: SEKALI untuk tiap gangguan (bukan terus-menerus selama alertnya
// aktif), dan bisa dibisukan. Bagian ini murni (tanpa browser) supaya aturannya
// bisa diuji; bunyinya sendiri ada di sound-engine.ts.

export type SoundKind = "warning" | "critical" | "test";

// Satu nada: frekuensi (Hz), kapan mulai dan berapa lama (detik, dihitung dari
// saat bunyi dimulai), dan kenyaringan puncaknya (0-1, sengaja pelan).
export interface Tone {
  frequency: number;
  start: number;
  duration: number;
  peak: number;
}

// Pola yang berbeda per tingkat, supaya bisa dibedakan tanpa melihat layar:
// peringatan satu nada, kritis dua nada bergantian yang lebih tinggi, dan nada
// pendek untuk uji saat suara dinyalakan. Semuanya di bawah satu detik.
export const soundPatterns: Record<SoundKind, Tone[]> = {
  warning: [{ frequency: 660, start: 0, duration: 0.3, peak: 0.18 }],
  critical: [
    { frequency: 988, start: 0, duration: 0.18, peak: 0.22 },
    { frequency: 740, start: 0.22, duration: 0.18, peak: 0.22 },
    { frequency: 988, start: 0.44, duration: 0.18, peak: 0.22 },
  ],
  test: [{ frequency: 523, start: 0, duration: 0.12, peak: 0.12 }],
};

// Bunyi untuk sekelompok alert baru: yang paling genting menentukan.
export function soundKindFor(
  alerts: readonly { severity: string }[],
): "warning" | "critical" {
  return alerts.some((alert) => alert.severity === "critical")
    ? "critical"
    : "warning";
}

export interface AlertSoundTracker {
  // Alert yang baru muncul sejak pengamatan sebelumnya, atau daftar kosong.
  // Pengamatan pertama dengan daftar (alert yang sudah ada saat halaman dibuka)
  // tidak dihitung baru. `null` (belum ada data) tidak mengubah apa pun.
  observe(active: readonly ActiveAlert[] | null): ActiveAlert[];
}

// Mengingat id yang sudah pernah terlihat aktif. Alert dianggap baru hanya sekali:
// yang sama di pengamatan berikutnya, atau yang selesai lalu tidak pernah kembali,
// tidak berbunyi lagi. Ingatan ini tetap diisi saat suara dibisukan, supaya
// membunyikannya kembali tidak memutar ulang gangguan yang sudah lewat.
export function createAlertSoundTracker(): AlertSoundTracker {
  const seen = new Set<string>();
  let baseline = false;
  return {
    observe(active) {
      if (active === null) return [];
      const fresh = baseline
        ? active.filter((alert) => !seen.has(alert.id))
        : [];
      baseline = true;
      for (const alert of active) seen.add(alert.id);
      return fresh;
    },
  };
}
