import { expect, test } from "@playwright/test";
import {
  billingStatusAtSlot,
  lastSuccessSlot,
  mockBillingOverview,
  mockBillingStatusAt,
  mockBillingSync,
  summarizeBilling,
  summarizeSync,
  withLiveStatuses,
  type BillingRow,
} from "../src/lib/dashboard/billing";
import { createMockCustomers } from "../src/lib/dashboard/mock-data";
import { createMockFeed } from "../src/lib/dashboard/mock-feed";
import {
  selectBillingStatuses,
  useDashboardStore,
} from "../src/lib/dashboard/store";
import type { BillingStatus, DashboardDelta } from "../src/lib/dashboard/types";
import {
  BILLING_START,
  changingRuns,
  nextSyncRun as nextRun,
} from "./billing-moments";

// Status tagihan yang berubah mengikuti sinkron billing, dan jalannya ke store:
// data tiruannya (fungsi dari waktu), umpan hub tiruan, store Zustand, dan
// penimpaan status di halaman Billing. Tanpa browser.

const HOUR = 3_600;
const baseCustomers = createMockCustomers();
const baseStatus = new Map(baseCustomers.map((c) => [c.id, c.billingStatus]));

test.describe("slot sinkron berhasil terakhir", () => {
  test("sama dengan sinkron berhasil terakhir di riwayat, di setiap momen", () => {
    const problems: string[] = [];
    for (let t = BILLING_START; t < BILLING_START + 3 * 86_400; t += 211) {
      const last = summarizeSync(mockBillingSync(t).runs).lastSuccess!;
      const expected = Number(last.id.replace("billing-sync-", ""));
      if (lastSuccessSlot(t) !== expected) problems.push(`${t}`);
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });

  test("berganti tepat pada detik sinkron yang berhasil selesai, dan tidak pada yang gagal", () => {
    let expected = lastSuccessSlot(BILLING_START);
    let from = BILLING_START;
    let successes = 0;
    let failures = 0;
    for (let i = 0; i < 80; i += 1) {
      const run = nextRun(from);
      expect(lastSuccessSlot(run.finishedAt - 1), `sebelum ${run.slot}`).toBe(
        expected,
      );
      if (run.status === "success") {
        expected = run.slot;
        successes += 1;
      } else {
        failures += 1;
      }
      expect(lastSuccessSlot(run.finishedAt), `saat ${run.slot}`).toBe(
        expected,
      );
      expect(lastSuccessSlot(run.finishedAt + 600)).toBe(expected);
      from = run.start;
    }
    // Keduanya terjadi, jadi pengujian ini bermakna.
    expect(successes).toBeGreaterThan(40);
    expect(failures).toBeGreaterThan(3);
  });

  test("tidak pernah mundur ketika waktu maju", () => {
    let previous = -Infinity;
    for (let t = BILLING_START; t < BILLING_START + 5 * 86_400; t += 97) {
      const slot = lastSuccessSlot(t);
      expect(slot >= previous, String(t)).toBe(true);
      previous = slot;
    }
  });
});

test.describe("status tagihan yang berubah", () => {
  const first = lastSuccessSlot(BILLING_START);
  const slots = Array.from({ length: 400 }, (_, i) => first + i);
  const matched = new Set(
    mockBillingOverview(BILLING_START)
      .rows.filter((row) => row.match !== "none")
      .map((row) => row.customerId),
  );

  test("hanya lunas atau isolir, dan id yang tidak dikenal tidak punya status", () => {
    for (const customer of baseCustomers) {
      for (const slot of slots.slice(0, 60)) {
        expect(["lunas", "isolir"]).toContain(
          billingStatusAtSlot(customer.id, slot),
        );
      }
    }
    expect(billingStatusAtSlot("tidak-ada", first)).toBeNull();
    expect(mockBillingStatusAt("tidak-ada", BILLING_START)).toBeNull();
  });

  test("sebagian kecil pelanggan berubah, hanya yang punya tagihan cocok, dan yang lain tetap", () => {
    const changing = new Set<string>();
    for (const customer of baseCustomers) {
      const seen = new Set(
        slots.map((s) => billingStatusAtSlot(customer.id, s)),
      );
      if (seen.size > 1) changing.add(customer.id);
      else expect([...seen][0], customer.id).toBe(baseStatus.get(customer.id));
    }
    expect(changing.size).toBeGreaterThanOrEqual(5);
    expect(changing.size).toBeLessThanOrEqual(25);
    for (const id of changing) expect(matched.has(id), id).toBe(true);
    // Pelanggan tanpa tagihan yang cocok tidak pernah berubah.
    for (const row of mockBillingOverview(BILLING_START).rows) {
      if (row.match !== "none") continue;
      for (const slot of slots.slice(0, 50)) {
        expect(billingStatusAtSlot(row.customerId, slot)).toBe(
          baseStatus.get(row.customerId),
        );
      }
    }
  });

  test("tiap pelanggan yang berubah bergantian lunas dan isolir dengan periode tetap 8 sampai 47 sinkron", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const customer of baseCustomers) {
      const flips: number[] = [];
      for (let i = 1; i < slots.length; i += 1) {
        const before = billingStatusAtSlot(customer.id, slots[i - 1])!;
        const after = billingStatusAtSlot(customer.id, slots[i])!;
        if (before !== after) flips.push(slots[i]);
      }
      if (flips.length < 3) continue;
      checked += 1;
      const gaps = flips.slice(1).map((slot, i) => slot - flips[i]);
      const period = gaps[0];
      if (period < 8 || period > 47) problems.push(`${customer.id}: ${period}`);
      if (gaps.some((gap) => gap !== period))
        problems.push(`${customer.id}: tidak tetap`);
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  test("baris halaman Billing memakai status itu pada tiap momen, dan angka lunas serta isolir menjumlah ke semua pelanggan", () => {
    const problems: string[] = [];
    const lunasCounts = new Set<number>();
    for (let t = BILLING_START; t < BILLING_START + 5 * 86_400; t += 1_800) {
      const { rows, unmatched } = mockBillingOverview(t);
      for (const row of rows) {
        const want =
          row.match === "none"
            ? baseStatus.get(row.customerId)
            : mockBillingStatusAt(row.customerId, t);
        if (row.status !== want) problems.push(`${t}/${row.customerId}`);
      }
      const totals = summarizeBilling(rows, unmatched);
      if (totals.lunas + totals.isolir !== 100) problems.push(`${t}: jumlah`);
      lunasCounts.add(totals.lunas);
    }
    expect(problems.slice(0, 5)).toEqual([]);
    // Angka lunas benar-benar berubah dalam lima hari.
    expect(lunasCounts.size).toBeGreaterThan(3);
  });

  test("baris yang sama dipakai ulang selama slotnya sama, dan baris yang tidak berubah tetap objek yang sama antar slot", () => {
    const run = nextRun(BILLING_START);
    const before = mockBillingOverview(run.finishedAt - 1).rows;
    expect(mockBillingOverview(run.finishedAt - 30).rows).toBe(before);
    const sameSlot = mockBillingOverview(run.finishedAt - 1).rows;
    expect(sameSlot).toBe(before);
    // Bandingkan dengan sinkron yang berhasil, bukan yang gagal.
    let later = run;
    while (later.status !== "success") later = nextRun(later.start);
    const after = mockBillingOverview(later.finishedAt).rows;
    expect(after).not.toBe(before);
    expect(after).toHaveLength(before.length);
    let same = 0;
    after.forEach((row, index) => {
      if (row.status === before[index].status) {
        expect(row, row.customerId).toBe(before[index]);
        same += 1;
      }
    });
    expect(same).toBeGreaterThan(after.length / 2);
  });
});

// --- Umpan hub tiruan ---------------------------------------------------------

function statusesOf(customers: { id: string; billingStatus: BillingStatus }[]) {
  return new Map(customers.map((c) => [c.id, c.billingStatus]));
}

function applyBilling(
  statuses: Map<string, BillingStatus>,
  delta: DashboardDelta,
) {
  for (const change of delta.billingChanges ?? []) {
    statuses.set(change.customerId, change.status);
  }
}

test.describe("umpan hub tiruan", () => {
  test("snapshot mengirim pelanggan dengan status tagihan yang berlaku, dan tidak mengubah yang lain", () => {
    const problems: string[] = [];
    let differing = 0;
    for (const t of [
      BILLING_START,
      BILLING_START + 20 * HOUR,
      BILLING_START + 71 * HOUR + 17,
    ]) {
      const input = createMockCustomers();
      const feed = createMockFeed(input);
      const { customers } = feed.snapshot(t);
      expect(customers).toHaveLength(100);
      customers.forEach((customer, index) => {
        const base = baseCustomers[index];
        const want = mockBillingStatusAt(customer.id, t);
        if (customer.billingStatus !== want)
          problems.push(`${t}/${customer.id}`);
        if (customer.billingStatus !== base.billingStatus) differing += 1;
        // Selain status tagihan, isinya sama dengan data awal.
        const same = JSON.stringify({
          ...customer,
          billingStatus: base.billingStatus,
        });
        if (same !== JSON.stringify(base))
          problems.push(`${customer.id}: isi lain berubah`);
        // Yang statusnya tidak berganti tetap objek yang sama dengan masukan.
        if (
          customer.billingStatus === base.billingStatus &&
          customer !== input[index]
        ) {
          problems.push(`${customer.id}: bukan objek yang sama`);
        }
      });
    }
    expect(problems.slice(0, 5)).toEqual([]);
    expect(differing).toBeGreaterThan(0);
  });

  test("delta tiap detik membawa perubahan status tagihan tepat pada detik sinkron berhasil selesai, dan hasilnya sama dengan snapshot", () => {
    const windows = changingRuns(40);
    let withMessage = 0;
    const problems: string[] = [];
    for (const { finishedAt } of windows) {
      const feed = createMockFeed(createMockCustomers());
      const statuses = statusesOf(feed.snapshot(finishedAt - 5).customers);
      for (let t = finishedAt - 4; t <= finishedAt + 5; t += 1) {
        const delta = feed.next(t);
        const has = (delta.billingChanges ?? []).length > 0;
        if (has !== (t === finishedAt))
          problems.push(`${finishedAt}: detik ${t - finishedAt}`);
        if (has) withMessage += 1;
        // Tidak ada kunci kosong: tanpa perubahan pesannya tidak memuat tagihan.
        if (!has && "billingChanges" in delta)
          problems.push(`${finishedAt}: kunci kosong`);
        applyBilling(statuses, delta);
      }
      const fresh = statusesOf(
        createMockFeed(createMockCustomers()).snapshot(finishedAt + 5)
          .customers,
      );
      for (const [id, status] of fresh) {
        if (statuses.get(id) !== status)
          problems.push(`${finishedAt}/${id}: berbeda dari snapshot`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    expect(withMessage).toBe(windows.length);
  });

  test("detik yang terlewat tidak membuat perubahan hilang: satu delta jauh di depan memuat seluruh bedanya", () => {
    for (const { finishedAt } of changingRuns(10)) {
      const feed = createMockFeed(createMockCustomers());
      const statuses = statusesOf(feed.snapshot(finishedAt - 5).customers);
      const delta = feed.next(finishedAt + 600);
      applyBilling(statuses, delta);
      const fresh = statusesOf(
        createMockFeed(createMockCustomers()).snapshot(finishedAt + 600)
          .customers,
      );
      expect([...statuses].filter(([id, s]) => fresh.get(id) !== s)).toEqual(
        [],
      );
      expect((delta.billingChanges ?? []).length).toBeGreaterThan(0);
    }
  });

  test("jam yang mundur memberi status yang berlaku pada jam itu", () => {
    const [{ finishedAt }] = changingRuns(1);
    const feed = createMockFeed(createMockCustomers());
    const later = statusesOf(feed.snapshot(finishedAt + 10).customers);
    const earlier = statusesOf(feed.snapshot(finishedAt - 10).customers);
    expect(
      [...later].filter(([id, s]) => earlier.get(id) !== s).length,
    ).toBeGreaterThan(0);
    for (const customer of baseCustomers) {
      expect(earlier.get(customer.id)).toBe(
        mockBillingStatusAt(customer.id, finishedAt - 10),
      );
    }
  });

  test("perubahan online dan offline tidak mengubah status tagihan", () => {
    const feed = createMockFeed(createMockCustomers());
    const t = BILLING_START;
    const statuses = statusesOf(feed.snapshot(t).customers);
    // Seluruh detik di dalam satu jam tanpa sinkron selesai: tak ada pesan tagihan.
    const run = nextRun(t);
    let messages = 0;
    for (let s = t + 1; s < Math.min(run.finishedAt - 1, t + 600); s += 1) {
      const delta = feed.next(s);
      messages += (delta.billingChanges ?? []).length;
      applyBilling(statuses, delta);
    }
    expect(messages).toBe(0);
    for (const [id, status] of statuses) {
      expect(status, id).toBe(mockBillingStatusAt(id, t));
    }
  });
});

// --- Store ------------------------------------------------------------------

function resetStore(t = BILLING_START) {
  const feed = createMockFeed(createMockCustomers());
  useDashboardStore.getState().applySnapshot(feed.snapshot(t), t);
}

const point = (time: number) => ({ time, rx: 1, tx: 1 });

test.describe("store Zustand", () => {
  test.beforeEach(() => resetStore());

  test("perubahan status tagihan mengganti hanya pelanggan itu, dan tidak menyentuh hitungan lain", () => {
    const before = useDashboardStore.getState();
    const target = before.customers.find((c) => c.billingStatus === "lunas")!;
    before.applyDelta(
      {
        traffic: point(1),
        statusChanges: [],
        billingChanges: [{ customerId: target.id, status: "isolir" }],
      },
      1,
    );
    const after = useDashboardStore.getState();
    expect(after.customers).not.toBe(before.customers);
    for (const customer of after.customers) {
      const old = before.customers.find((c) => c.id === customer.id)!;
      if (customer.id === target.id) {
        expect(customer).not.toBe(old);
        expect(customer).toEqual({ ...old, billingStatus: "isolir" });
      } else {
        expect(customer, customer.id).toBe(old);
      }
    }
    expect(after.onlineCount).toBe(before.onlineCount);
    expect(after.offlineCount).toBe(before.offlineCount);
    expect(after.weakSignalCount).toBe(before.weakSignalCount);
  });

  test("delta tanpa kunci tagihan bekerja seperti sebelumnya", () => {
    const before = useDashboardStore.getState();
    const target = before.customers.find((c) => c.isOnline)!;
    before.applyDelta(
      {
        traffic: point(1),
        statusChanges: [{ customerId: target.id, isOnline: false }],
      },
      1,
    );
    const after = useDashboardStore.getState();
    expect(after.customers.find((c) => c.id === target.id)!.isOnline).toBe(
      false,
    );
    expect(after.offlineCount).toBe(before.offlineCount + 1);
    expect(after.customers.find((c) => c.id === target.id)!.billingStatus).toBe(
      target.billingStatus,
    );
  });

  test("perubahan online dan tagihan untuk pelanggan yang sama diterapkan keduanya", () => {
    const before = useDashboardStore.getState();
    const target = before.customers.find(
      (c) => c.isOnline && c.billingStatus === "lunas",
    )!;
    before.applyDelta(
      {
        traffic: point(1),
        statusChanges: [{ customerId: target.id, isOnline: false }],
        billingChanges: [{ customerId: target.id, status: "isolir" }],
      },
      1,
    );
    const changed = useDashboardStore
      .getState()
      .customers.find((c) => c.id === target.id)!;
    expect(changed.isOnline).toBe(false);
    expect(changed.billingStatus).toBe("isolir");
  });

  test("pesan yang sama dua kali, atau yang tidak mengubah apa pun, tidak menggantikan pelanggan", () => {
    const before = useDashboardStore.getState();
    const target = before.customers[0];
    const message: DashboardDelta = {
      traffic: point(1),
      statusChanges: [],
      billingChanges: [{ customerId: target.id, status: target.billingStatus }],
    };
    before.applyDelta(message, 1);
    // Status yang sama dengan yang sudah ada: daftar pelanggan tidak diganti.
    expect(useDashboardStore.getState().customers).toBe(before.customers);
    const flipped = target.billingStatus === "lunas" ? "isolir" : "lunas";
    const change: DashboardDelta = {
      ...message,
      billingChanges: [{ customerId: target.id, status: flipped }],
    };
    before.applyDelta(change, 2);
    const once = useDashboardStore.getState().customers;
    expect(once).not.toBe(before.customers);
    useDashboardStore.getState().applyDelta(change, 3);
    expect(useDashboardStore.getState().customers).toBe(once);
  });

  test("id yang tidak dikenal diabaikan", () => {
    const before = useDashboardStore.getState();
    before.applyDelta(
      {
        traffic: point(1),
        statusChanges: [],
        billingChanges: [{ customerId: "tidak-ada", status: "isolir" }],
      },
      1,
    );
    expect(useDashboardStore.getState().customers).toBe(before.customers);
  });

  test("snapshot menggantikan semua status tagihan", () => {
    const t = changingRuns(1)[0].finishedAt + 2;
    const feed = createMockFeed(createMockCustomers());
    useDashboardStore.getState().applySnapshot(feed.snapshot(t), t);
    for (const customer of useDashboardStore.getState().customers) {
      expect(customer.billingStatus, customer.id).toBe(
        mockBillingStatusAt(customer.id, t),
      );
    }
  });

  test("pemilih status tagihan memberi peta id ke status, yang sama selama tak ada status yang berganti", () => {
    const state = useDashboardStore.getState();
    const map = selectBillingStatuses(state);
    expect(Object.keys(map)).toHaveLength(100);
    for (const customer of state.customers) {
      expect(map[customer.id]).toBe(customer.billingStatus);
    }
    // Perubahan online tidak mengubah isi petanya.
    const target = state.customers.find((c) => c.isOnline)!;
    state.applyDelta(
      {
        traffic: point(1),
        statusChanges: [{ customerId: target.id, isOnline: false }],
      },
      1,
    );
    expect(selectBillingStatuses(useDashboardStore.getState())).toEqual(map);
  });
});

// --- Penimpaan di halaman Billing -----------------------------------------------

test.describe("status terbaru dari store pada baris halaman Billing", () => {
  const rows = mockBillingOverview(BILLING_START).rows;
  const live = (changes: Record<string, BillingStatus>) => ({
    ...Object.fromEntries(rows.map((r) => [r.customerId, r.status])),
    ...changes,
  });

  test("tidak ada yang berubah: daftar yang sama dikembalikan", () => {
    expect(withLiveStatuses(rows, live({}))).toBe(rows);
    expect(withLiveStatuses(rows, {})).toBe(rows);
  });

  test("yang berubah menjadi baris baru, yang lain tetap objek yang sama, dan masukan tidak diubah", () => {
    const frozen = Object.freeze(
      rows.map((row) => Object.freeze({ ...row })),
    ) as BillingRow[];
    const target = frozen.find(
      (row) => row.match === "exact" && row.status === "lunas",
    )!;
    const before = JSON.stringify(frozen);
    const next = withLiveStatuses(
      frozen,
      live({ [target.customerId]: "isolir" }),
    );
    expect(JSON.stringify(frozen)).toBe(before);
    expect(next).not.toBe(frozen);
    next.forEach((row, index) => {
      if (row.customerId === target.customerId) {
        expect(row.status).toBe("isolir");
        expect({ ...row, status: "lunas" }).toEqual(frozen[index]);
      } else {
        expect(row).toBe(frozen[index]);
      }
    });
  });

  test("pelanggan tanpa tagihan tidak pernah ditimpa, dan id yang tidak ada di store diabaikan", () => {
    const none = rows.find((row) => row.match === "none")!;
    const flipped = none.status === "lunas" ? "isolir" : "lunas";
    expect(withLiveStatuses(rows, live({ [none.customerId]: flipped }))).toBe(
      rows,
    );
    const partial = Object.fromEntries(
      rows.slice(5).map((r) => [r.customerId, r.status]),
    );
    expect(withLiveStatuses(rows, partial)).toBe(rows);
  });

  test("angka ringkasan dari baris yang ditimpa sama dengan hitungan dari status store", () => {
    const matched = rows.filter((row) => row.match !== "none");
    const changes: Record<string, BillingStatus> = {};
    for (const row of matched.slice(0, 7)) {
      changes[row.customerId] = row.status === "lunas" ? "isolir" : "lunas";
    }
    const next = withLiveStatuses(rows, live(changes));
    const before = summarizeBilling(rows, []);
    const after = summarizeBilling(next, []);
    const toIsolir = Object.values(changes).filter(
      (s) => s === "isolir",
    ).length;
    expect(after.isolir).toBe(before.isolir + toIsolir - (7 - toIsolir));
    expect(after.lunas + after.isolir).toBe(before.lunas + before.isolir);
  });
});
