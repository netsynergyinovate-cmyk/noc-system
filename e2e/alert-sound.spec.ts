import { expect, test } from "@playwright/test";
import { createMockAlertHub } from "../src/lib/dashboard/alert-sync";
import {
  createAlertSoundTracker,
  soundKindFor,
  soundPatterns,
  type SoundKind,
} from "../src/lib/dashboard/alert-sound";
import { mockActiveAlerts } from "../src/lib/dashboard/alerts";
import {
  createSoundEngine,
  type AudioContextLike,
} from "../src/lib/dashboard/sound-engine";
import { GRID, START } from "./alert-moments";

// Suara alert: sekali untuk tiap gangguan baru, bisa dibisukan, dan menghormati
// larangan suara otomatis dari browser. Tanpa browser: aturannya (alert-sound.ts)
// dan mesin bunyinya (sound-engine.ts, dengan AudioContext tiruan).

test.describe("pola bunyi", () => {
  const kinds = Object.keys(soundPatterns) as SoundKind[];

  test("setiap pola terdengar, pelan, dan pendek", () => {
    for (const kind of kinds) {
      const tones = soundPatterns[kind];
      expect(tones.length, kind).toBeGreaterThan(0);
      let previousStart = -1;
      for (const tone of tones) {
        expect(tone.frequency, kind).toBeGreaterThanOrEqual(200);
        expect(tone.frequency, kind).toBeLessThanOrEqual(2_000);
        expect(tone.duration, kind).toBeGreaterThanOrEqual(0.05);
        expect(tone.duration, kind).toBeLessThanOrEqual(0.6);
        // Tidak keras: puncaknya jauh di bawah penuh.
        expect(tone.peak, kind).toBeGreaterThan(0);
        expect(tone.peak, kind).toBeLessThanOrEqual(0.3);
        expect(tone.start, kind).toBeGreaterThanOrEqual(previousStart);
        previousStart = tone.start;
      }
      // Seluruh pola selesai kurang dari satu detik.
      const end = Math.max(...tones.map((t) => t.start + t.duration));
      expect(end, kind).toBeLessThan(1);
    }
  });

  test("kritis berbeda dari peringatan dan bisa dikenali tanpa melihat layar", () => {
    const { warning, critical, test: check } = soundPatterns;
    expect(critical.length).toBeGreaterThan(warning.length);
    expect(Math.max(...critical.map((t) => t.frequency))).toBeGreaterThan(
      Math.max(...warning.map((t) => t.frequency)),
    );
    // Dua nada yang berbeda bergantian, bukan satu nada diulang.
    expect(new Set(critical.map((t) => t.frequency)).size).toBeGreaterThan(1);
    // Nada uji lebih singkat dan lebih pelan daripada bunyi alert.
    const length = (tones: typeof warning) =>
      Math.max(...tones.map((t) => t.start + t.duration));
    expect(length(check)).toBeLessThan(length(warning));
    expect(check[0].peak).toBeLessThan(warning[0].peak);
  });

  test("yang paling genting menentukan bunyi untuk sekelompok alert", () => {
    expect(soundKindFor([])).toBe("warning");
    expect(soundKindFor([{ severity: "warning" }])).toBe("warning");
    expect(soundKindFor([{ severity: "info" }])).toBe("warning");
    expect(
      soundKindFor([{ severity: "warning" }, { severity: "critical" }]),
    ).toBe("critical");
    expect(
      soundKindFor([{ severity: "critical" }, { severity: "warning" }]),
    ).toBe("critical");
  });
});

test.describe("sekali untuk tiap gangguan", () => {
  const at = (offset: number) => mockActiveAlerts(START + offset);

  test("alert yang sudah ada saat halaman dibuka bukan gangguan baru", () => {
    const tracker = createAlertSoundTracker();
    const existing = at(0);
    expect(existing.length).toBeGreaterThan(0);
    expect(tracker.observe(existing)).toEqual([]);
    // Dan tetap tidak berbunyi di pengamatan berikutnya.
    expect(tracker.observe(existing)).toEqual([]);
  });

  test("belum ada data tidak mengubah apa pun, dan pengamatan pertama dengan data tetap dasar", () => {
    const tracker = createAlertSoundTracker();
    expect(tracker.observe(null)).toEqual([]);
    expect(tracker.observe(null)).toEqual([]);
    expect(tracker.observe(at(0))).toEqual([]);
    // Sesudah data ada, yang baru dikenali.
    const later = at(7_200);
    const known = new Set(at(0).map((a) => a.id));
    const expected = later.filter((a) => !known.has(a.id)).map((a) => a.id);
    expect(tracker.observe(later).map((a) => a.id)).toEqual(expected);
  });

  test("alert yang sama tidak berbunyi lagi, juga bila hilang lalu muncul kembali", () => {
    const tracker = createAlertSoundTracker();
    tracker.observe([]);
    const [first, second] = at(7_200);
    expect(tracker.observe([first]).map((a) => a.id)).toEqual([first.id]);
    expect(tracker.observe([first])).toEqual([]);
    expect(tracker.observe([first, second]).map((a) => a.id)).toEqual([
      second.id,
    ]);
    // Daftar kosong sebentar (mis. sambungan terputus), lalu kembali: bukan baru.
    expect(tracker.observe([])).toEqual([]);
    expect(tracker.observe([first, second])).toEqual([]);
  });

  test("beberapa alert baru sekaligus dikembalikan bersama, supaya berbunyi sekali", () => {
    const tracker = createAlertSoundTracker();
    tracker.observe([]);
    // Momen dengan sedikitnya tiga alert aktif sekaligus.
    const group = mockActiveAlerts(
      GRID.find((t) => mockActiveAlerts(t).length >= 3)!,
    ).slice(0, 3);
    expect(group.length).toBe(3);
    expect(tracker.observe(group).map((a) => a.id)).toEqual(
      group.map((a) => a.id),
    );
    // Id ganda dalam satu daftar tidak menggandakan.
    const tracker2 = createAlertSoundTracker();
    tracker2.observe([]);
    expect(tracker2.observe([group[0], group[0]]).length).toBe(2);
    expect(tracker2.observe([group[0]])).toEqual([]);
  });

  test("sepanjang waktu, jumlah yang berbunyi sama dengan alert yang benar-benar baru", () => {
    const hub = createMockAlertHub();
    let now = START + 20_000;
    const tracker = createAlertSoundTracker();
    const baseline = hub.snapshot(now);
    tracker.observe(baseline.active);
    const everSeen = new Set(baseline.active.map((a) => a.id));
    const announced = new Map<string, number>();
    let current = baseline.active;
    for (let step = 0; step < 10_800; step += 1) {
      now += 1;
      const message = hub.changes(now);
      if (message) current = message.active;
      for (const alert of tracker.observe(current)) {
        announced.set(alert.id, (announced.get(alert.id) ?? 0) + 1);
        everSeen.add(alert.id);
      }
    }
    // Setiap alert yang baru muncul berbunyi tepat sekali, dan hanya itu.
    expect([...announced.values()].every((count) => count === 1)).toBe(true);
    expect(announced.size).toBeGreaterThan(8);
    const expected = new Set<string>();
    for (let t = START + 20_000 + 1; t <= now; t += 1) {
      for (const alert of mockActiveAlerts(t)) expected.add(alert.id);
    }
    for (const alert of baseline.active) expected.delete(alert.id);
    expect([...announced.keys()].sort()).toEqual([...expected].sort());
  });

  test("lompatan waktu jauh: yang muncul selama komputer tidur berbunyi sekali", () => {
    const tracker = createAlertSoundTracker();
    tracker.observe(at(0));
    const jumped = at(3 * 86_400);
    const known = new Set(at(0).map((a) => a.id));
    const expected = jumped.filter((a) => !known.has(a.id));
    expect(expected.length).toBeGreaterThan(0);
    expect(tracker.observe(jumped).map((a) => a.id)).toEqual(
      expected.map((a) => a.id),
    );
  });
});

// AudioContext tiruan yang mencatat apa yang dijadwalkan.
function fakeContext(initialState = "suspended") {
  const oscillators: Array<{
    type: string;
    frequency: number;
    start?: number;
    stop?: number;
    chain: string[];
  }> = [];
  const gains: Array<{ calls: string[] }> = [];
  const destination = { name: "destination" };
  const context: AudioContextLike & {
    resumeCalls: number;
    rejectResume: boolean;
    oscillators: typeof oscillators;
    gains: typeof gains;
  } = {
    state: initialState,
    currentTime: 10,
    destination,
    resumeCalls: 0,
    rejectResume: false,
    oscillators,
    gains,
    async resume() {
      context.resumeCalls += 1;
      if (context.rejectResume) throw new Error("ditolak browser");
      context.state = "running";
    },
    createOscillator() {
      const entry: (typeof oscillators)[number] = {
        type: "square",
        frequency: 0,
        chain: [],
      };
      oscillators.push(entry);
      const node = {
        get type() {
          return entry.type;
        },
        set type(value: string) {
          entry.type = value;
        },
        frequency: {
          get value() {
            return entry.frequency;
          },
          set value(value: number) {
            entry.frequency = value;
          },
        },
        connect(target: unknown) {
          entry.chain.push((target as { name?: string }).name ?? "gain");
          return target;
        },
        start(time: number) {
          entry.start = time;
        },
        stop(time: number) {
          entry.stop = time;
        },
      };
      return node;
    },
    createGain() {
      const entry = { calls: [] as string[] };
      gains.push(entry);
      return {
        gain: {
          setValueAtTime: () => entry.calls.push("set"),
          linearRampToValueAtTime: () => entry.calls.push("up"),
          exponentialRampToValueAtTime: () => entry.calls.push("down"),
        },
        connect(target: unknown) {
          entry.calls.push(`to:${(target as { name?: string }).name}`);
          return target;
        },
      };
    },
  };
  return context;
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    storage: {
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => {
        data[key] = value;
      },
    },
  };
}

test.describe("mesin bunyi", () => {
  test("sebelum browser mengizinkan, tidak berbunyi dan mengaku tidak berhasil", async () => {
    const context = fakeContext();
    const engine = createSoundEngine({
      createContext: () => context,
      storage: () => memoryStorage().storage,
    });
    expect(engine.getSnapshot()).toEqual({ enabled: true, unlocked: false });
    expect(engine.play("warning")).toBe(false);
    expect(context.oscillators).toHaveLength(0);
  });

  test("klik pertama membuka suara, memberi tahu pelanggan sekali, lalu bunyi terdengar", async () => {
    const context = fakeContext();
    const engine = createSoundEngine({
      createContext: () => context,
      storage: () => memoryStorage().storage,
    });
    let notified = 0;
    engine.subscribe(() => (notified += 1));
    const before = engine.getSnapshot();
    expect(await engine.unlock()).toBe(true);
    expect(engine.getSnapshot()).toEqual({ enabled: true, unlocked: true });
    expect(engine.getSnapshot()).not.toBe(before);
    expect(notified).toBe(1);
    // Membuka lagi tidak mengubah apa pun, dan snapshot-nya objek yang sama.
    const after = engine.getSnapshot();
    expect(await engine.unlock()).toBe(true);
    expect(engine.getSnapshot()).toBe(after);
    expect(notified).toBe(1);
    expect(context.resumeCalls).toBe(1);
  });

  test("setiap pola dijadwalkan persis seperti rancangannya", async () => {
    const context = fakeContext();
    const engine = createSoundEngine({
      createContext: () => context,
      storage: () => memoryStorage().storage,
    });
    await engine.unlock();
    for (const kind of ["warning", "critical", "test"] as const) {
      context.oscillators.length = 0;
      context.gains.length = 0;
      expect(engine.play(kind)).toBe(true);
      const tones = soundPatterns[kind];
      expect(context.oscillators).toHaveLength(tones.length);
      expect(context.gains).toHaveLength(tones.length);
      tones.forEach((tone, index) => {
        const oscillator = context.oscillators[index];
        expect(oscillator.frequency, kind).toBe(tone.frequency);
        expect(oscillator.type).toBe("sine");
        // Dihitung dari detik sekarang milik konteks.
        expect(oscillator.start).toBeCloseTo(10 + tone.start, 6);
        expect(oscillator.stop!).toBeGreaterThan(
          10 + tone.start + tone.duration,
        );
        // Osilator ke penguat, dan penguat ke keluaran; naik lalu turun halus.
        expect(oscillator.chain).toEqual(["gain"]);
        expect(context.gains[index].calls).toEqual([
          "set",
          "up",
          "down",
          "to:destination",
        ]);
      });
    }
  });

  test("dibisukan: tidak berbunyi, tersimpan, dan bertahan di mesin yang baru", async () => {
    const context = fakeContext();
    const memory = memoryStorage();
    const engine = createSoundEngine({
      createContext: () => context,
      storage: () => memory.storage,
    });
    await engine.unlock();
    await engine.setEnabled(false);
    expect(memory.data.alertSound).toBe("off");
    expect(engine.isEnabled()).toBe(false);
    expect(engine.getSnapshot()).toEqual({ enabled: false, unlocked: true });
    context.oscillators.length = 0;
    expect(engine.play("critical")).toBe(false);
    expect(context.oscillators).toHaveLength(0);

    // Halaman dimuat ulang: mesin baru membaca pilihan yang tersimpan.
    const reloaded = createSoundEngine({
      createContext: () => fakeContext(),
      storage: () => memory.storage,
    });
    expect(reloaded.getSnapshot().enabled).toBe(false);
  });

  test("menyalakan kembali memperdengarkan nada uji sekali, dan alert berikutnya berbunyi", async () => {
    const context = fakeContext();
    const memory = memoryStorage({ alertSound: "off" });
    const engine = createSoundEngine({
      createContext: () => context,
      storage: () => memory.storage,
    });
    expect(engine.isEnabled()).toBe(false);
    await engine.setEnabled(true);
    expect(memory.data.alertSound).toBe("on");
    expect(context.oscillators).toHaveLength(soundPatterns.test.length);
    expect(context.oscillators[0].frequency).toBe(
      soundPatterns.test[0].frequency,
    );
    expect(engine.getSnapshot()).toEqual({ enabled: true, unlocked: true });
    expect(engine.play("warning")).toBe(true);
    expect(context.oscillators).toHaveLength(
      soundPatterns.test.length + soundPatterns.warning.length,
    );
  });

  test("tanpa klik pengguna browser menahan suara: menyalakan tidak berbunyi sampai diizinkan", async () => {
    const context = fakeContext();
    context.rejectResume = true;
    const engine = createSoundEngine({
      createContext: () => context,
      storage: () => memoryStorage().storage,
    });
    expect(await engine.unlock()).toBe(false);
    await engine.setEnabled(true);
    expect(engine.getSnapshot()).toEqual({ enabled: true, unlocked: false });
    expect(context.oscillators).toHaveLength(0);
    expect(engine.play("critical")).toBe(false);
    // Setelah browser mengizinkan (klik berikutnya), bunyi terdengar.
    context.rejectResume = false;
    expect(await engine.unlock()).toBe(true);
    expect(engine.play("critical")).toBe(true);
    expect(context.oscillators).toHaveLength(soundPatterns.critical.length);
  });

  test("tanpa Web Audio atau penyimpanan yang diblokir, tidak ada yang rusak", async () => {
    const none = createSoundEngine({
      createContext: () => null,
      storage: () => null,
    });
    expect(none.getSnapshot()).toEqual({ enabled: true, unlocked: false });
    expect(await none.unlock()).toBe(false);
    expect(none.play("warning")).toBe(false);
    await none.setEnabled(false);
    expect(none.isEnabled()).toBe(false);

    const broken = createSoundEngine({
      createContext: () => fakeContext(),
      storage: () => {
        throw new Error("diblokir");
      },
    });
    expect(broken.isEnabled()).toBe(true);
    await broken.setEnabled(false);
    // Pilihannya tetap berlaku di sesi ini walau tidak bisa disimpan.
    expect(broken.isEnabled()).toBe(false);
    expect(broken.getSnapshot().enabled).toBe(false);
  });

  test("konteks yang sudah berjalan dari awal tidak perlu dilanjutkan", async () => {
    const context = fakeContext("running");
    const engine = createSoundEngine({
      createContext: () => context,
      storage: () => memoryStorage().storage,
    });
    expect(await engine.unlock()).toBe(true);
    expect(context.resumeCalls).toBe(0);
    expect(engine.play("warning")).toBe(true);
  });
});
