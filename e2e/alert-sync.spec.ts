import { expect, test } from "@playwright/test";
import {
  createMockAlertHub,
  emptyAlertState,
  listSignature,
  mergeAlerts,
  mergeEnded,
  messageState,
  pruneResolved,
  snapshotState,
  type AlertState,
  type AlertsMessage,
} from "../src/lib/dashboard/alert-sync";
import { useAlertStore } from "../src/lib/dashboard/alert-store";
import {
  ALERT_HISTORY_SECONDS,
  mockActiveAlerts,
  mockResolvedAlerts,
  type ResolvedAlert,
} from "../src/lib/dashboard/alerts";
import { unit } from "../src/lib/dashboard/mock-random";
import { START, findMoments } from "./alert-moments";

// Store alert dan pesan hub: keadaan yang dibangun dari snapshot lalu pesan-pesan
// susulan harus selalu sama dengan keadaan sebenarnya pada detik itu, pesan yang
// diterapkan ulang tidak mengubah apa pun, dan alert yang tidak berubah tetap
// objek yang sama. Tanpa browser.

const WEEK = ALERT_HISTORY_SECONDS;

// "sama", atau di mana daftar pertama berbeda dari yang kedua. Dipakai alih-alih
// toEqual pada daftar ratusan alert: selisihnya mahal dihitung bila berbeda.
function difference(
  actual: readonly object[] | null,
  expected: readonly object[],
) {
  if (actual === null) return "null";
  if (actual.length !== expected.length)
    return `panjang ${actual.length} berbanding ${expected.length}`;
  for (let index = 0; index < actual.length; index += 1) {
    if (JSON.stringify(actual[index]) !== JSON.stringify(expected[index])) {
      const [a, b] = [actual[index], expected[index]] as Array<{ id: string }>;
      return `indeks ${index}: ${a.id} berbanding ${b.id}`;
    }
  }
  return "sama";
}

const truth = (now: number): AlertState => ({
  active: mockActiveAlerts(now),
  resolved: mockResolvedAlerts(now),
  updatedAt: now,
});

// Menjalankan hub dan reducer seperti DashboardFeed: satu snapshot, lalu satu
// pemeriksaan tiap langkah waktu, dengan riwayat dipangkas tiap langkah.
function replay(
  from: number,
  gaps: number[],
  visit: (
    now: number,
    state: AlertState,
    message: AlertsMessage | null,
  ) => void,
) {
  const hub = createMockAlertHub();
  let now = from;
  let state = snapshotState(emptyAlertState, hub.snapshot(now), now);
  visit(now, state, null);
  for (const gap of gaps) {
    now += gap;
    const message = hub.changes(now);
    if (message) state = messageState(state, message, now);
    else state = { ...state, updatedAt: now };
    state = {
      ...state,
      resolved: state.resolved && pruneResolved(state.resolved, now),
    };
    visit(now, state, message);
  }
  return state;
}

const seededGaps = (seed: number, count: number, max: number) =>
  Array.from(
    { length: count },
    (_, index) => 1 + Math.floor(unit(seed * 100_003 + index) * max),
  );

test.describe("pesan alert dari hub", () => {
  test("snapshot lalu pesan susulan selalu sama dengan keadaan sebenarnya, dengan selang waktu acak", () => {
    let messages = 0;
    let steps = 0;
    for (const seed of [1, 2, 3]) {
      replay(
        START + seed * 7_919,
        seededGaps(seed, 400, 90),
        (now, state, message) => {
          steps += 1;
          if (message) messages += 1;
          const expected = truth(now);
          expect(
            difference(state.active, expected.active!),
            `aktif @${now}`,
          ).toBe("sama");
          expect(
            difference(state.resolved, expected.resolved!),
            `riwayat @${now}`,
          ).toBe("sama");
        },
      );
    }
    expect(steps).toBeGreaterThan(1_000);
    // Pesan hanya saat ada yang berubah, bukan tiap langkah.
    expect(messages).toBeGreaterThan(20);
    expect(messages).toBeLessThan(steps / 2);
  });

  test("juga benar dengan langkah satu detik, seperti timer di DashboardFeed", () => {
    replay(START + 40_000, Array(900).fill(1), (now, state) => {
      if ((now - (START + 40_000)) % 5 !== 0) return;
      const expected = truth(now);
      expect(difference(state.active, expected.active!), `aktif @${now}`).toBe(
        "sama",
      );
      expect(
        difference(state.resolved, expected.resolved!),
        `riwayat @${now}`,
      ).toBe("sama");
    });
  });

  test("satu alert ada di tepat satu daftar pada setiap langkah", () => {
    replay(START + 90_000, seededGaps(9, 500, 40), (now, state) => {
      const ids = [...state.active!, ...state.resolved!].map((a) => a.id);
      expect(new Set(ids).size, `@${now}`).toBe(ids.length);
    });
  });

  test("setiap alert yang selesai muncul di tepat satu pesan, di detik pemeriksaan yang melewatinya", () => {
    const seen = new Map<string, number>();
    const hub = createMockAlertHub();
    let now = START + 120_000;
    hub.snapshot(now);
    const first = now;
    const outOfRange: string[] = [];
    for (let step = 0; step < 7_200; step += 1) {
      now += 1;
      for (const alert of hub.changes(now)?.ended ?? []) {
        seen.set(alert.id, (seen.get(alert.id) ?? 0) + 1);
        // Selesainya benar di antara pemeriksaan sebelumnya dan sekarang.
        if (alert.endedAt <= now - 1 || alert.endedAt > now)
          outOfRange.push(alert.id);
      }
    }
    expect(outOfRange).toEqual([]);
    const expected = mockResolvedAlerts(now, now - first).map((a) => a.id);
    expect([...seen.keys()].sort()).toEqual(expected.sort());
    expect([...seen.values()].every((count) => count === 1)).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  test("tanpa perubahan hub tidak mengirim apa pun, juga bila diperiksa pada detik yang sama", () => {
    const hub = createMockAlertHub();
    const now = START + 5_000;
    hub.snapshot(now);
    expect(hub.changes(now)).toBeNull();
    expect(hub.changes(now)).toBeNull();
    // Menjelang detik pertama yang mengubah sesuatu: null sampai tepat saat itu.
    let tick = now;
    let found: AlertsMessage | null = null;
    while (!found && tick < now + 3_000) {
      tick += 1;
      found = hub.changes(tick);
    }
    expect(found).not.toBeNull();
    expect(hub.changes(tick)).toBeNull();
  });

  test("pesan yang sama diterapkan dua kali tidak mengubah apa pun dan menjaga objeknya", () => {
    let checked = 0;
    const hub = createMockAlertHub();
    let now = START + 30_000;
    let state = snapshotState(emptyAlertState, hub.snapshot(now), now);
    for (let step = 0; step < 600; step += 1) {
      now += 7;
      const message = hub.changes(now);
      if (!message) continue;
      const once = messageState(state, message, now);
      const twice = messageState(once, message, now);
      expect(twice.active).toBe(once.active);
      expect(twice.resolved).toBe(once.resolved);
      state = once;
      checked += 1;
    }
    expect(checked).toBeGreaterThan(5);
  });

  test("alert yang isinya tidak berubah tetap objek yang sama di pesan berikutnya", () => {
    let reused = 0;
    const replaced: string[] = [];
    let previous: AlertState | null = null;
    replay(START + 60_000, seededGaps(5, 300, 30), (now, state) => {
      if (previous) {
        const before = new Map(previous.active!.map((a) => [a.id, a]));
        for (const alert of state.active!) {
          const old = before.get(alert.id);
          if (old && listSignature([old]) === listSignature([alert])) {
            if (alert !== old) replaced.push(`aktif ${alert.id}@${now}`);
            reused += 1;
          }
        }
        const resolvedBefore = new Map(
          previous.resolved!.map((a) => [a.id, a]),
        );
        for (const alert of state.resolved!) {
          const old = resolvedBefore.get(alert.id);
          if (old && alert !== old) replaced.push(`riwayat ${alert.id}@${now}`);
        }
      }
      previous = state;
    });
    expect(replaced).toEqual([]);
    expect(reused).toBeGreaterThan(100);
  });

  test("lompatan waktu: sinkron ulang memberi keadaan sebenarnya, dan tidak ada pesan susulan palsu", () => {
    const hub = createMockAlertHub();
    let now = START;
    let state = snapshotState(emptyAlertState, hub.snapshot(now), now);
    for (const jump of [3 * 3600, 2 * 86_400, 11 * 86_400, 3_600]) {
      now += jump;
      state = snapshotState(state, hub.snapshot(now), now);
      const expected = truth(now);
      expect(difference(state.active, expected.active!)).toBe("sama");
      expect(difference(state.resolved, expected.resolved!)).toBe("sama");
      // Tepat setelah sinkron ulang tidak ada yang berubah.
      expect(hub.changes(now)).toBeNull();
    }
  });

  test("jam mundur: sinkron ulang memulihkan keadaan, dan pesan tidak menyimpang", () => {
    const hub = createMockAlertHub();
    let now = START + 50_000;
    let state = snapshotState(emptyAlertState, hub.snapshot(now), now);
    now -= 4_000;
    state = snapshotState(state, hub.snapshot(now), now);
    expect(difference(state.active, truth(now).active!)).toBe("sama");
    expect(difference(state.resolved, truth(now).resolved!)).toBe("sama");
    const message = hub.changes(now + 1);
    if (message) state = messageState(state, message, now + 1);
    expect(difference(state.active, truth(now + 1).active!)).toBe("sama");
  });
});

test.describe("menggabungkan alert ke store", () => {
  const history = () => mockResolvedAlerts(START + 200_000);

  test("mergeAlerts mengembalikan daftar lama bila tidak ada yang berubah, dan memakai urutan yang baru", () => {
    const list = history().slice(0, 20);
    const copy = list.map((alert) => ({ ...alert }));
    expect(mergeAlerts(list, copy)).toBe(list);
    expect(mergeAlerts(null, copy)).toBe(copy);
    const reversed = [...copy].reverse();
    const merged = mergeAlerts(list, reversed);
    expect(merged.map((a) => a.id)).toEqual(reversed.map((a) => a.id));
    expect(merged[0]).toBe(list[19]);
    // Satu alert berubah: hanya itu yang diganti.
    const changed = copy.map((a, i) =>
      i === 3 ? { ...a, severity: "info" as const } : a,
    );
    const next = mergeAlerts(list, changed);
    expect(next).not.toBe(list);
    expect(next[3]).toBe(changed[3]);
    expect(next[4]).toBe(list[4]);
  });

  test("mergeEnded menambah yang baru di tempat yang benar, tanpa menggandakan", () => {
    const all = history();
    const base = all.slice(10);
    const newer = all.slice(0, 3);
    const merged = mergeEnded(base, [...newer, newer[0], base[0]]);
    expect(merged.map((a) => a.id)).toEqual(
      [...newer, ...base].map((a) => a.id),
    );
    expect(merged.slice(0, 3)).toEqual(newer);
    // Tanpa yang baru: daftar yang sama, objek yang sama.
    expect(mergeEnded(base, [])).toBe(base);
    expect(mergeEnded(base, [base[2]])).toBe(base);
    // Urutan masuk tidak berpengaruh.
    expect(mergeEnded(base, [...newer].reverse()).map((a) => a.id)).toEqual(
      merged.map((a) => a.id),
    );
  });

  test("pruneResolved membuang yang lewat jendela, dan mengembalikan daftar yang sama bila tidak ada", () => {
    const now = START + 300_000;
    const list = mockResolvedAlerts(now);
    expect(pruneResolved(list, now)).toBe(list);
    const later = now + 3_600;
    const pruned = pruneResolved(list, later);
    expect(pruned.length).toBeLessThan(list.length);
    expect(pruned.every((a) => a.endedAt > later - WEEK)).toBe(true);
    expect(pruned).toEqual(list.filter((a) => a.endedAt > later - WEEK));
    // Batas tegas: selesai tepat di batas sudah keluar.
    const edge = list[list.length - 1];
    expect(pruneResolved(list, edge.endedAt + WEEK).includes(edge)).toBe(false);
    expect(pruneResolved(list, edge.endedAt + WEEK - 1).includes(edge)).toBe(
      true,
    );
    expect(pruneResolved([], now)).toEqual([]);
  });

  test("riwayat yang lebih panjang dari jendela dipangkas, juga yang datang lewat pesan", () => {
    const now = START + 900_000;
    const long = mockResolvedAlerts(now, WEEK * 2);
    expect(long.length).toBeGreaterThan(mockResolvedAlerts(now).length);
    const state = snapshotState(
      emptyAlertState,
      { active: [], resolved: long },
      now,
    );
    expect(state.resolved!.every((a) => a.endedAt > now - WEEK)).toBe(true);
    expect(difference(state.resolved, mockResolvedAlerts(now))).toBe("sama");
    // Alert yang selesainya sudah di luar jendela tidak masuk riwayat lewat pesan.
    const expired = long[long.length - 1];
    expect(expired.endedAt).toBeLessThanOrEqual(now - WEEK);
    const next = messageState(state, { active: [], ended: [expired] }, now);
    expect(next.resolved!.map((a) => a.id)).not.toContain(expired.id);
    expect(difference(next.resolved, state.resolved!)).toBe("sama");
  });

  test("alert yang ada di daftar aktif dan di yang selesai: yang selesai menang", () => {
    const now = findMoments().mixed.t;
    const resolved = mockResolvedAlerts(now);
    const active = mockActiveAlerts(now);
    expect(active.length).toBeGreaterThan(0);
    const state = snapshotState(
      emptyAlertState,
      { active, resolved: [...resolved, { ...resolved[0] } as ResolvedAlert] },
      now,
    );
    expect(new Set(state.resolved!.map((a) => a.id)).size).toBe(
      new Set(resolved.map((a) => a.id)).size,
    );
    // Satu alert aktif dipaksa juga selesai: ia keluar dari aktif.
    const both = { ...resolved[1], id: active[0].id };
    const merged = messageState(state, { active, ended: [both] }, now);
    expect(merged.active!.map((a) => a.id)).not.toContain(active[0].id);
    expect(merged.resolved!.map((a) => a.id)).toContain(active[0].id);
  });

  test("pesan sebelum riwayat diterima hanya menerapkan daftar aktif", () => {
    const now = START + 500_000;
    const active = mockActiveAlerts(now);
    const state = messageState(
      emptyAlertState,
      { active, ended: mockResolvedAlerts(now).slice(0, 3) },
      now,
    );
    expect(state.active).toEqual(active);
    expect(state.resolved).toBeNull();
    expect(state.updatedAt).toBe(now);
  });
});

test.describe("store Zustand", () => {
  test.beforeEach(() => useAlertStore.getState().reset());

  test("mulai kosong, terisi oleh snapshot, dan kembali kosong saat diputus", () => {
    const store = useAlertStore;
    expect(store.getState().active).toBeNull();
    expect(store.getState().resolved).toBeNull();
    expect(store.getState().updatedAt).toBeNull();
    const now = START + 600_000;
    store
      .getState()
      .applySnapshot(
        { active: mockActiveAlerts(now), resolved: mockResolvedAlerts(now) },
        now,
      );
    expect(difference(store.getState().active, mockActiveAlerts(now))).toBe(
      "sama",
    );
    expect(difference(store.getState().resolved, mockResolvedAlerts(now))).toBe(
      "sama",
    );
    expect(store.getState().updatedAt).toBe(now);
    store.getState().reset();
    expect(store.getState().active).toBeNull();
    expect(store.getState().resolved).toBeNull();
  });

  test("pesan hub menggeser alert dari aktif ke atas riwayat dalam satu pembaruan", () => {
    const store = useAlertStore;
    const hub = createMockAlertHub();
    let now = START + 700_000;
    store.getState().applySnapshot(hub.snapshot(now), now);
    let moved: AlertsMessage | null = null;
    const states: Array<{ active: string[]; resolved: string[] }> = [];
    const unsubscribe = store.subscribe((state) =>
      states.push({
        active: state.active!.map((a) => a.id),
        resolved: state.resolved!.map((a) => a.id),
      }),
    );
    while (!moved) {
      now += 1;
      const message = hub.changes(now);
      if (message?.ended.length) {
        moved = message;
        store.getState().applyMessage(message, now);
      }
    }
    unsubscribe();
    // Satu pembaruan saja, dan di dalamnya tidak ada alert di dua daftar.
    expect(states).toHaveLength(1);
    const [update] = states;
    for (const alert of moved.ended) {
      expect(update.active).not.toContain(alert.id);
      expect(update.resolved).toContain(alert.id);
    }
    expect(store.getState().resolved![0].id).toBe(
      [...moved.ended].sort(
        (a, b) => b.endedAt - a.endedAt || a.id.localeCompare(b.id),
      )[0].id,
    );
  });

  test("prune tidak memberi tahu pelanggan bila tidak ada yang dibuang, dan memangkas bila ada", () => {
    const store = useAlertStore;
    const now = START + 800_000;
    store
      .getState()
      .applySnapshot(
        { active: mockActiveAlerts(now), resolved: mockResolvedAlerts(now) },
        now,
      );
    let notified = 0;
    const unsubscribe = store.subscribe(() => (notified += 1));
    store.getState().prune(now);
    expect(notified).toBe(0);
    const before = store.getState().resolved!;
    store.getState().prune(now + 4 * 3_600);
    expect(notified).toBe(1);
    expect(store.getState().resolved!.length).toBeLessThan(before.length);
    expect(difference(store.getState().active, mockActiveAlerts(now))).toBe(
      "sama",
    );
    unsubscribe();
    // Sebelum ada riwayat, memangkas tidak berbuat apa-apa.
    store.getState().reset();
    store.getState().prune(now);
    expect(store.getState().resolved).toBeNull();
  });
});
