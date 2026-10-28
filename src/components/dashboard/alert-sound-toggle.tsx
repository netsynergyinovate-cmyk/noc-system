"use client";

import { useSyncExternalStore } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { soundEngine, type SoundSnapshot } from "@/lib/dashboard/sound-engine";

// Tampilan di server sebelum pilihan tersimpan dibaca: suara menyala tetapi
// belum diizinkan browser.
const serverSnapshot: SoundSnapshot = { enabled: true, unlocked: false };

const states = {
  off: {
    label: "mati",
    hint: "Suara alert mati. Klik untuk menyalakan.",
  },
  waiting: {
    label: "menunggu klik",
    hint: "Suara alert menyala, tetapi browser menahan suara sampai Anda berinteraksi dengan halaman. Klik di mana saja.",
  },
  on: {
    label: "aktif",
    hint: "Suara alert aktif: gangguan baru berbunyi sekali. Klik untuk membisukan.",
  },
} as const;

// Tombol bisu suara alert. Namanya tetap "Suara alert" dan keadaannya dibaca dari
// aria-pressed; tulisan di sampingnya (dan tooltip) menyebut keadaannya bagi yang
// melihat, termasuk "menunggu klik" ketika browser belum mengizinkan suara.
export function AlertSoundToggle() {
  const { enabled, unlocked } = useSyncExternalStore(
    soundEngine.subscribe,
    soundEngine.getSnapshot,
    () => serverSnapshot,
  );
  const state = !enabled ? "off" : unlocked ? "on" : "waiting";
  const Icon = enabled ? Volume2 : VolumeX;
  return (
    // relative: teks sr-only bersifat absolute; tanpa penampung berposisi ia bisa
    // melebarkan halaman.
    <span className="relative inline-flex">
      <Button
        type="button"
        variant={enabled ? "secondary" : "ghost"}
        size="sm"
        className="h-7 px-2 text-xs gap-1.5 rounded-lg"
        aria-label="Suara alert"
        aria-pressed={enabled}
        title={states[state].hint}
        data-testid="alert-sound-toggle"
        data-state={state}
        onClick={() => void soundEngine.setEnabled(!enabled)}
      >
        <Icon aria-hidden="true" />
        {/* Lebar tetap: semua tulisan keadaan ditumpuk di satu sel dan hanya yang
            sekarang terlihat, jadi tombol tidak berubah lebar (dan tidak menggeser
            yang lain) ketika keadaannya berganti. */}
        <span aria-hidden="true" className="grid">
          {(Object.keys(states) as Array<keyof typeof states>).map((key) => (
            <span
              key={key}
              className={cn(
                "col-start-1 row-start-1 text-left",
                key !== state && "invisible",
              )}
            >
              Suara: {states[key].label}
            </span>
          ))}
        </span>
      </Button>
      {/* Di luar tombol: isi tombol dibaca sebagai satu bagian, bukan region status. */}
      <span role="status" className="sr-only">
        {states[state].hint}
      </span>
    </span>
  );
}
