import { expect, test } from "@playwright/test";
import {
  ALERT_HISTORY_PAGE_SIZE,
  ALERT_HISTORY_SECONDS,
  POLL_SECONDS,
  describeTimeSource,
  loadAlertLists,
  loadResolvedAlerts,
  locationFor,
  reconcileAlertLists,
  mockActiveAlerts,
  mockResolvedAlerts,
  sortResolvedAlerts,
  type ActiveAlert,
  type ResolvedAlert,
} from "../src/lib/dashboard/alerts";
import { anomalyRules } from "../src/lib/dashboard/anomalies";
import { paginate } from "../src/lib/dashboard/paging";

// Riwayat alert selesai: datanya, dan hubungannya dengan daftar alert aktif.
// Tanpa browser. Pemeriksaan terpenting ada di bagian "pindah": alert yang
// aktif tadi harus berada di riwayat dengan isian yang sama begitu selesai,
// tepat pada detiknya, dan tidak pernah tampil di keduanya.

const NOW = 1_791_400_000;
const WEEK = ALERT_HISTORY_SECONDS;

// Isian yang tidak boleh berubah ketika alert pindah dari aktif ke riwayat.
const stableFields = [
  "id",
  "kind",
  "severity",
  "startedAt",
  "detectedAt",
  "timeSource",
  "timeUncertaintySeconds",
  "routerId",
  "customerId",
  "interfaceName",
  "measured",
  "location",
] as const;

function stable(alert: ActiveAlert | ResolvedAlert) {
  return Object.fromEntries(stableFields.map((key) => [key, alert[key]]));
}

test.describe("data riwayat alert tiruan", () => {
  test("sama setiap dihitung untuk waktu yang sama, dan lewat loader yang sama", async () => {
    expect(mockResolvedAlerts(NOW)).toEqual(mockResolvedAlerts(NOW));
    expect(await loadResolvedAlerts(NOW)).toEqual(mockResolvedAlerts(NOW));
    expect(await loadResolvedAlerts(NOW, 3600)).toEqual(
      mockResolvedAlerts(NOW, 3600),
    );
  });

  test("setiap alert sudah selesai, di dalam jendela, dengan waktu yang masuk akal", () => {
    const forSeconds = Object.fromEntries(
      anomalyRules.map((rule) => [rule.kind, rule.forSeconds]),
    );
    const problems: string[] = [];
    for (let offset = 0; offset < 3 * 86_400; offset += 4_321) {
      const now = NOW + offset;
      const alerts = mockResolvedAlerts(now);
      for (const alert of alerts) {
        const where = `${alert.id}@${offset}`;
        if (!Number.isInteger(alert.endedAt))
          problems.push(`${where}: endedAt`);
        if (alert.endedAt > now) problems.push(`${where}: belum selesai`);
        if (alert.endedAt <= now - WEEK)
          problems.push(`${where}: di luar jendela`);
        if (alert.endedAt <= alert.startedAt)
          problems.push(`${where}: selesai sebelum mulai`);
        if (
          alert.detectedAt < alert.startedAt ||
          alert.detectedAt > alert.endedAt
        )
          problems.push(`${where}: terdeteksi di luar masa hidupnya`);
        if (alert.detectedAt !== alert.startedAt + forSeconds[alert.kind])
          problems.push(`${where}: detectedAt tidak mengikuti aturan`);
        if (alert.timeUncertaintySeconds < 0)
          problems.push(`${where}: ketidakpastian negatif`);
        if (alert.timeSource === "event" && alert.timeUncertaintySeconds !== 0)
          problems.push(`${where}: dari router tetapi tidak pasti`);
        if (
          JSON.stringify(alert.location) !== JSON.stringify(locationFor(alert))
        )
          problems.push(`${where}: lokasi berbeda`);
      }
      if (new Set(alerts.map((alert) => alert.id)).size !== alerts.length)
        problems.push(`${offset}: id ganda`);
    }
    expect(problems).toEqual([]);
  });

  test("waktu selesai membawa ketelitiannya sendiri: dari router tepat, dari polling sebesar selang pollingnya", () => {
    const problems: string[] = [];
    const combos = new Set<string>();
    // Data tiruan tanpa alert yang ditandai petugas: hanya event dan poll muncul.
    const offlineEnds: Record<string, number> = { event: 0, poll: 0 };
    for (let offset = 0; offset < 7 * 86_400; offset += 3_600) {
      for (const alert of mockResolvedAlerts(NOW + offset, 3_600)) {
        const where = `${alert.id}`;
        if (
          alert.endTimeSource === "event" &&
          alert.endTimeUncertaintySeconds !== 0
        )
          problems.push(`${where}: dari router tetapi tidak pasti`);
        if (
          alert.endTimeSource === "poll" &&
          alert.endTimeUncertaintySeconds !== POLL_SECONDS[alert.kind]
        )
          problems.push(`${where}: selang polling salah`);
        if (alert.kind !== "offline" && alert.endTimeSource !== "poll")
          problems.push(
            `${where}: hanya pelanggan offline yang punya event pulih`,
          );
        if (alert.kind === "offline") {
          combos.add(`${alert.timeSource}/${alert.endTimeSource}`);
          offlineEnds[alert.endTimeSource] += 1;
        }
      }
    }
    expect(problems).toEqual([]);
    // Mulai dan selesai bisa berasal dari sumber yang berbeda, dan keempat
    // pasangan benar-benar muncul di data.
    expect([...combos].sort()).toEqual([
      "event/event",
      "event/poll",
      "poll/event",
      "poll/poll",
    ]);
    const share = offlineEnds.event / (offlineEnds.event + offlineEnds.poll);
    expect(share).toBeGreaterThan(0.55);
    expect(share).toBeLessThan(0.85);
  });

  test("penjelasan sumber waktu selesai memakai kata pulih, dan label pendeknya sama dengan waktu mulai", () => {
    const event = { timeSource: "event", timeUncertaintySeconds: 0 } as const;
    const poll = { timeSource: "poll", timeUncertaintySeconds: 30 } as const;
    expect(describeTimeSource(event, "end").short).toBe(
      describeTimeSource(event, "start").short,
    );
    expect(describeTimeSource(poll, "end").short).toBe("polling ±30 detik");
    expect(describeTimeSource(event, "end").long).toContain("pulih");
    expect(describeTimeSource(poll, "end").long).toContain("pulih");
    expect(describeTimeSource(poll, "end").long).toContain("30 detik");
    expect(describeTimeSource(event, "start").long).toContain("kejadian");
    expect(describeTimeSource(poll, "start").long).toContain("kejadian");
    // Tanpa argumen kedua tetap waktu mulai, seperti sebelumnya.
    expect(describeTimeSource(poll)).toEqual(describeTimeSource(poll, "start"));
    // Waktu mulai dan waktu selesai tidak saling menimpa penjelasannya.
    expect(describeTimeSource(poll, "end").long).not.toBe(
      describeTimeSource(poll, "start").long,
    );
  });

  test("urut dari yang paling akhir selesai, dan urutannya tegas", () => {
    const alerts = mockResolvedAlerts(NOW);
    expect(alerts.length).toBeGreaterThan(200);
    for (let i = 1; i < alerts.length; i += 1) {
      const [before, after] = [alerts[i - 1], alerts[i]];
      expect(before.endedAt >= after.endedAt, `${before.id} ${after.id}`).toBe(
        true,
      );
      if (before.endedAt === after.endedAt) {
        expect(before.id.localeCompare(after.id)).toBeLessThan(0);
      }
    }
    // Urutan masukan tidak memengaruhi hasil, dan masukannya tidak diubah.
    const shuffled = [...alerts].reverse();
    expect(sortResolvedAlerts(shuffled)).toEqual(alerts);
    expect(shuffled[0]).toBe(alerts[alerts.length - 1]);
  });

  test("jumlahnya masuk akal untuk tujuh hari, dan jendela yang lebih kecil memberi himpunan bagian", () => {
    const week = mockResolvedAlerts(NOW);
    const day = mockResolvedAlerts(NOW, 86_400);
    const hour = mockResolvedAlerts(NOW, 3_600);
    expect(week.length).toBeGreaterThan(200);
    expect(week.length).toBeLessThan(1100);
    expect(day.length).toBeLessThan(week.length);
    expect(hour.length).toBeLessThanOrEqual(day.length);
    const weekIds = new Set(week.map((alert) => alert.id));
    const dayIds = new Set(day.map((alert) => alert.id));
    for (const alert of day) expect(weekIds.has(alert.id)).toBe(true);
    for (const alert of hour) expect(dayIds.has(alert.id)).toBe(true);
    // Jendela nol tidak memuat apa pun.
    expect(mockResolvedAlerts(NOW, 0)).toEqual([]);
    // Riwayat yang diminta dengan jendela besar memuat semua yang kecil.
    expect(mockResolvedAlerts(NOW, WEEK * 2).length).toBeGreaterThan(
      week.length,
    );
  });

  test("jendela mana pun memberi persis yang selesai di dalamnya, tidak ada yang terlewat di tepinya", () => {
    // Pembanding: jendela yang jauh lebih lebar, disaring ke jendela yang sempit.
    // Alert yang mulai jauh sebelum jendela sempit tetapi selesai di dalamnya
    // (masa hidup sampai 90 menit) tidak boleh hilang.
    const windows = [90, 600, 3_599, 3_600, 7_201, 21_600, 86_399, 172_800];
    const problems: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      const now = NOW + i * 9_973 + (i % 7) * 61;
      for (const windowSeconds of windows) {
        const narrow = mockResolvedAlerts(now, windowSeconds).map((a) => a.id);
        const expected = mockResolvedAlerts(now, windowSeconds + 86_400)
          .filter((alert) => alert.endedAt > now - windowSeconds)
          .map((a) => a.id);
        if (JSON.stringify(narrow) !== JSON.stringify(expected))
          problems.push(
            `${now}/${windowSeconds}: ${narrow.length} vs ${expected.length}`,
          );
      }
    }
    expect(problems).toEqual([]);
  });

  test("batas jendela tegas sampai satu detik: selesai tepat di batas belum masuk", () => {
    const sample = mockResolvedAlerts(NOW, 86_400)[40];
    const has = (now: number, windowSeconds: number) =>
      mockResolvedAlerts(now, windowSeconds).some(
        (alert) => alert.id === sample.id,
      );
    // Batas atas: ada tepat pada detik selesai, belum ada sedetik sebelumnya.
    expect(has(sample.endedAt, WEEK)).toBe(true);
    expect(has(sample.endedAt - 1, WEEK)).toBe(false);
    // Batas bawah: masih masuk jendela sedetik sebelum keluar, lalu keluar.
    expect(has(sample.endedAt + WEEK - 1, WEEK)).toBe(true);
    expect(has(sample.endedAt + WEEK, WEEK)).toBe(false);
  });
});

test.describe("alert berpindah dari daftar aktif ke riwayat", () => {
  // Alert aktif pada beberapa waktu, dan riwayat sesudah semuanya pasti selesai
  // (alert terlama hidup kurang dari 6000 detik) untuk mengetahui kapan selesai.
  const times = Array.from({ length: 80 }, (_, i) => NOW + i * 2_357);

  test("daftar aktif dan riwayat tidak pernah memuat alert yang sama", () => {
    const shared: string[] = [];
    for (let offset = 0; offset < 2 * 86_400; offset += 211) {
      const active = new Set(mockActiveAlerts(NOW + offset).map((a) => a.id));
      for (const alert of mockResolvedAlerts(NOW + offset)) {
        if (active.has(alert.id)) shared.push(`${alert.id}@${offset}`);
      }
    }
    expect(shared).toEqual([]);
  });

  test("setiap alert aktif muncul di riwayat dengan isian yang sama persis sesudah selesai", () => {
    let checked = 0;
    for (const t of times) {
      const later = new Map(
        mockResolvedAlerts(t + 6_000).map((alert) => [alert.id, alert]),
      );
      for (const alert of mockActiveAlerts(t)) {
        const done = later.get(alert.id);
        expect(done, `${alert.id} tidak masuk riwayat`).toBeTruthy();
        expect(stable(done!)).toEqual(stable(alert));
        expect(done!.endedAt).toBeGreaterThan(t);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  test("pindahnya tepat pada detik selesai: sedetik sebelumnya masih aktif, pada detiknya sudah riwayat", () => {
    let checked = 0;
    for (const t of times) {
      const later = new Map(
        mockResolvedAlerts(t + 6_000).map((alert) => [alert.id, alert]),
      );
      for (const alert of mockActiveAlerts(t).slice(0, 3)) {
        const { endedAt } = later.get(alert.id)!;
        const activeIds = (now: number) =>
          mockActiveAlerts(now).map((item) => item.id);
        const resolvedIds = (now: number) =>
          mockResolvedAlerts(now).map((item) => item.id);

        expect(activeIds(endedAt - 1)).toContain(alert.id);
        expect(resolvedIds(endedAt - 1)).not.toContain(alert.id);

        expect(activeIds(endedAt)).not.toContain(alert.id);
        // Yang baru selesai berada paling atas di riwayat.
        const justNow = mockResolvedAlerts(endedAt);
        expect(justNow.map((item) => item.id)).toContain(alert.id);
        expect(justNow[0].endedAt).toBe(endedAt);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  test("setiap alert di riwayat pernah aktif: terdeteksi pada detiknya, belum sedetik sebelumnya", () => {
    const history = mockResolvedAlerts(NOW + 3 * 86_400);
    let checked = 0;
    for (let i = 0; i < history.length; i += 7) {
      const alert = history[i];
      const at = (now: number) =>
        mockActiveAlerts(now).some((item) => item.id === alert.id);
      expect(at(alert.detectedAt), `${alert.id} saat terdeteksi`).toBe(true);
      expect(at(alert.endedAt - 1), `${alert.id} sebelum selesai`).toBe(true);
      // Kondisi yang bertahan di bawah lamanya aturan belum menjadi alert.
      if (alert.detectedAt > alert.startedAt) {
        expect(at(alert.detectedAt - 1), `${alert.id} sebelum terdeteksi`).toBe(
          false,
        );
      }
      expect(at(alert.endedAt), `${alert.id} sesudah selesai`).toBe(false);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(30);
  });

  test("loadAlertLists memuat keduanya pada waktu yang sama, juga tepat pada detik ada alert yang selesai", async () => {
    // Detik selesai beberapa alert: di sanalah dua daftar yang dimuat pada waktu
    // berbeda akan berselisih (alert hilang dari aktif tetapi belum di riwayat).
    const endings = mockResolvedAlerts(NOW + 86_400)
      .filter((_, index) => index % 11 === 0)
      .slice(0, 25)
      .map((alert) => alert.endedAt);
    expect(endings.length).toBeGreaterThan(20);
    for (const t of [
      ...times.slice(0, 10),
      ...endings,
      ...endings.map((e) => e - 1),
    ]) {
      const lists = await loadAlertLists(t);
      expect(lists.active).toEqual(mockActiveAlerts(t));
      expect(lists.resolved).toEqual(mockResolvedAlerts(t));
      const ids = [...lists.active, ...lists.resolved].map((a) => a.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    for (const end of endings) {
      const lists = await loadAlertLists(end);
      expect(lists.resolved[0].endedAt).toBe(end);
    }
  });

  test("pemuatan yang tidak seketika: alert yang selesai di antara dua permintaan dibuang dari daftar aktif", () => {
    let overlapping = 0;
    for (const t of times.slice(0, 40)) {
      const later = new Map(
        mockResolvedAlerts(t + 6_000).map((alert) => [alert.id, alert]),
      );
      for (const alert of mockActiveAlerts(t).slice(0, 2)) {
        const end = later.get(alert.id)!.endedAt;
        // Aktif diminta sedetik sebelum selesai, riwayat sesudahnya.
        const active = mockActiveAlerts(end - 1);
        const resolved = mockResolvedAlerts(end);
        expect(active.map((a) => a.id)).toContain(alert.id);
        expect(resolved.map((a) => a.id)).toContain(alert.id);
        const lists = reconcileAlertLists(active, resolved);
        const activeIds = lists.active.map((a) => a.id);
        const resolvedIds = new Set(lists.resolved.map((a) => a.id));
        // Tidak ada alert di dua daftar, dan yang selesai tetap di riwayat.
        expect(activeIds.filter((id) => resolvedIds.has(id))).toEqual([]);
        expect(activeIds).not.toContain(alert.id);
        expect(resolvedIds.has(alert.id)).toBe(true);
        // Yang lain tidak tersentuh, urutannya tetap, dan riwayat apa adanya.
        expect(activeIds).toEqual(
          active.map((a) => a.id).filter((id) => !resolvedIds.has(id)),
        );
        expect(lists.resolved).toBe(resolved);
        overlapping += 1;
      }
    }
    expect(overlapping).toBeGreaterThan(30);
  });

  test("pada pemuatan yang seketika reconcileAlertLists tidak mengubah apa pun", () => {
    for (const t of times.slice(0, 30)) {
      const active = mockActiveAlerts(t);
      const lists = reconcileAlertLists(active, mockResolvedAlerts(t));
      expect(lists.active).toEqual(active);
    }
  });

  test("tidak ada alert yang hilang di antara dua daftar sepanjang waktu", () => {
    // Alert apa pun yang aktif pada detik t harus tetap ada di salah satu daftar
    // pada setiap detik sesudahnya, selama masih di dalam jendela riwayat.
    const t0 = NOW + 1_000;
    const watched = mockActiveAlerts(t0).map((alert) => alert.id);
    expect(watched.length).toBeGreaterThan(0);
    for (let offset = 0; offset <= 6_500; offset += 13) {
      const now = t0 + offset;
      const present = new Set([
        ...mockActiveAlerts(now).map((alert) => alert.id),
        ...mockResolvedAlerts(now).map((alert) => alert.id),
      ]);
      for (const id of watched) {
        expect(present.has(id), `${id} hilang pada +${offset}`).toBe(true);
      }
    }
  });
});

test.describe("membagi riwayat menjadi halaman", () => {
  const items = Array.from({ length: 47 }, (_, i) => i + 1);

  test("halaman berurutan menutupi seluruh daftar tepat sekali", () => {
    const seen: number[] = [];
    const first = paginate(items, 1, 15);
    for (let page = 1; page <= first.pageCount; page += 1) {
      seen.push(...paginate(items, page, 15).items);
    }
    expect(first.pageCount).toBe(4);
    expect(seen).toEqual(items);
  });

  test("nomor baris pertama dan terakhir sesuai, termasuk halaman yang tidak penuh", () => {
    expect(paginate(items, 1, 15)).toMatchObject({
      from: 1,
      to: 15,
      total: 47,
    });
    expect(paginate(items, 2, 15)).toMatchObject({ from: 16, to: 30 });
    expect(paginate(items, 4, 15)).toMatchObject({
      from: 46,
      to: 47,
      page: 4,
      pageCount: 4,
    });
    expect(paginate(items, 4, 15).items).toEqual([46, 47]);
  });

  test("nomor yang tidak sah dipaksa masuk rentang", () => {
    const wanted = (page: number) => paginate(items, page, 15).page;
    expect(wanted(0)).toBe(1);
    expect(wanted(-3)).toBe(1);
    expect(wanted(1.5)).toBe(1);
    expect(wanted(Number.NaN)).toBe(1);
    expect(wanted(Number.POSITIVE_INFINITY)).toBe(1);
    expect(wanted(5)).toBe(4);
    expect(wanted(999)).toBe(4);
  });

  test("daftar yang menyusut tidak meninggalkan halaman kosong", () => {
    // Pengguna di halaman 4, lalu dua alert terakhir keluar dari jendela.
    const shrunk = paginate(items.slice(0, 45), 4, 15);
    expect(shrunk.page).toBe(3);
    expect(shrunk.items).toEqual(items.slice(30, 45));
  });

  test("daftar kosong tetap satu halaman, tanpa nomor baris", () => {
    expect(paginate([], 1, 15)).toEqual({
      page: 1,
      pageCount: 1,
      items: [],
      from: 0,
      to: 0,
      total: 0,
    });
    expect(paginate([], 7, 15).page).toBe(1);
  });

  test("berlaku untuk jumlah dan ukuran halaman mana pun", () => {
    for (let total = 0; total <= 60; total += 1) {
      for (const size of [1, 7, 15, 60]) {
        const list = Array.from({ length: total }, (_, i) => i);
        const count = paginate(list, 1, size).pageCount;
        expect(count).toBe(Math.max(1, Math.ceil(total / size)));
        const joined = Array.from(
          { length: count },
          (_, i) => paginate(list, i + 1, size).items,
        ).flat();
        expect(joined, `${total}/${size}`).toEqual(list);
      }
    }
  });

  test("riwayat tiruan tujuh hari terbagi sesuai ukuran halaman yang dipakai halaman", () => {
    const history = mockResolvedAlerts(NOW);
    const first = paginate(history, 1, ALERT_HISTORY_PAGE_SIZE);
    expect(first.items).toHaveLength(ALERT_HISTORY_PAGE_SIZE);
    expect(first.pageCount).toBe(
      Math.ceil(history.length / ALERT_HISTORY_PAGE_SIZE),
    );
    expect(first.items[0].id).toBe(history[0].id);
  });
});
