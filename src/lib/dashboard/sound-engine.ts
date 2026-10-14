import { soundPatterns, type SoundKind } from "./alert-sound";

// Bunyi lewat Web Audio dan pilihan bisu/aktif. Dua batasan browser membentuknya:
//
//  1. Browser menahan suara sampai pengguna berinteraksi dengan halaman
//     (kebijakan autoplay). AudioContext baru dibuat dan dilanjutkan saat ada
//     klik atau tombol; sebelum itu `play` tidak berbunyi dan mengaku tidak
//     berhasil, dan tombol suara menyebutnya ("menunggu klik").
//  2. Pilihan bisu harus bertahan setelah halaman dimuat ulang, tetapi
//     penyimpanan bisa diblokir; bila begitu, pilihan hanya berlaku di sesi ini.

const STORAGE_KEY = "alertSound";

// Bagian AudioContext yang dipakai, supaya bisa diganti dengan tiruan di uji.
export interface AudioContextLike {
  state: string;
  currentTime: number;
  destination: unknown;
  resume(): Promise<void>;
  createOscillator(): {
    type: string;
    frequency: { value: number };
    connect(node: unknown): unknown;
    start(time: number): void;
    stop(time: number): void;
  };
  createGain(): {
    gain: {
      setValueAtTime(value: number, time: number): void;
      linearRampToValueAtTime(value: number, time: number): void;
      exponentialRampToValueAtTime(value: number, time: number): void;
    };
    connect(node: unknown): unknown;
  };
}

export interface SoundSnapshot {
  // Pilihan pengguna: bunyikan alert baru.
  enabled: boolean;
  // Browser sudah mengizinkan suara (ada interaksi).
  unlocked: boolean;
}

export interface SoundEngineOptions {
  createContext?: () => AudioContextLike | null;
  storage?: () => Pick<Storage, "getItem" | "setItem"> | null;
}

function defaultCreateContext(): AudioContextLike | null {
  if (typeof window === "undefined") return null;
  const Context =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  return Context ? (new Context() as unknown as AudioContextLike) : null;
}

function defaultStorage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function createSoundEngine({
  createContext = defaultCreateContext,
  storage = defaultStorage,
}: SoundEngineOptions = {}) {
  let context: AudioContextLike | null = null;
  // Pilihan di sesi ini; dibaca dari penyimpanan saat pertama dibutuhkan.
  let enabled: boolean | null = null;
  let snapshot: SoundSnapshot | null = null;
  const listeners = new Set<() => void>();

  function readEnabled() {
    if (enabled === null) {
      try {
        enabled = storage()?.getItem(STORAGE_KEY) !== "off";
      } catch {
        enabled = true;
      }
    }
    return enabled;
  }

  const isUnlocked = () => context !== null && context.state === "running";

  function refresh() {
    const next = { enabled: readEnabled(), unlocked: isUnlocked() };
    if (
      snapshot === null ||
      snapshot.enabled !== next.enabled ||
      snapshot.unlocked !== next.unlocked
    ) {
      snapshot = next;
      for (const listener of [...listeners]) listener();
    }
  }

  // Dipanggil dari klik atau tombol pengguna. Membuat konteks bila belum ada
  // dan melanjutkannya bila ditahan browser. Benar bila suara sudah boleh.
  async function unlock() {
    try {
      context ??= createContext();
      if (context && context.state !== "running") await context.resume();
    } catch {
      // Ditolak browser: tetap terkunci, dan tombol tetap menyebutnya.
    }
    refresh();
    return isUnlocked();
  }

  // Membunyikan pola. Benar bila nadanya dijadwalkan; salah bila suara dibisukan
  // atau browser belum mengizinkannya.
  function play(kind: SoundKind) {
    if (!readEnabled() || !context || context.state !== "running") return false;
    const now = context.currentTime;
    for (const tone of soundPatterns[kind]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const begin = now + tone.start;
      const end = begin + tone.duration;
      oscillator.type = "sine";
      oscillator.frequency.value = tone.frequency;
      // Naik dan turun halus supaya tidak berdetak di awal dan akhir nada.
      gain.gain.setValueAtTime(0.0001, begin);
      gain.gain.linearRampToValueAtTime(tone.peak, begin + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(begin);
      oscillator.stop(end + 0.02);
    }
    return true;
  }

  // Menyalakan atau membisukan, dan mengingatnya. Menyalakan dipanggil dari klik
  // pengguna, jadi sekalian membuka suara dan memperdengarkan nada uji.
  async function setEnabled(next: boolean) {
    enabled = next;
    try {
      storage()?.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      // Penyimpanan diblokir: pilihan hanya berlaku di sesi ini.
    }
    refresh();
    if (next && (await unlock())) play("test");
  }

  return {
    // Untuk useSyncExternalStore: objek yang sama sampai isinya berubah.
    getSnapshot(): SoundSnapshot {
      if (snapshot === null) {
        snapshot = { enabled: readEnabled(), unlocked: isUnlocked() };
      }
      return snapshot;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    unlock,
    play,
    isEnabled: readEnabled,
    setEnabled,
  };
}

export type SoundEngine = ReturnType<typeof createSoundEngine>;

// Satu mesin untuk seluruh halaman.
export const soundEngine = createSoundEngine();
