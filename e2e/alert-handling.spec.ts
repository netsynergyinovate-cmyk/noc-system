import { expect, test } from "@playwright/test";
import {
  createMockAlertActions,
  handleFailureMessages,
  type HandleAlertResult,
} from "../src/lib/dashboard/alert-actions";
import {
  createMockAlertHub,
  createMockAlertSource,
  emptyAlertState,
  handledState,
  messageState,
  pruneResolved,
  snapshotState,
  type AlertState,
} from "../src/lib/dashboard/alert-sync";
import {
  ALERT_HISTORY_SECONDS,
  describeHandled,
  describeTimeSource,
  loadActiveAlerts,
  loadAlertLists,
  loadResolvedAlerts,
  mockActiveAlerts,
  mockResolvedAlerts,
  sortResolvedAlerts,
  type ResolvedAlert,
} from "../src/lib/dashboard/alerts";
import {
  HANDLED_RETENTION_SECONDS,
  createHandledRegistry,
  noHandled,
  parseHandled,
  pruneHandled,
  serializeHandled,
  type HandledMap,
  type HandledRecord,
} from "../src/lib/dashboard/handled-registry";
import { unit } from "../src/lib/dashboard/mock-random";
import {
  defaultResolvedFilters,
  filterResolvedAlerts,
  resolvedFacetCounts,
  searchableText,
  type SubjectDirectory,
} from "../src/lib/dashboard/resolved-filter";
import { START, findMoments } from "./alert-moments";

// Alert yang ditandai ditangani petugas, tanpa browser: catatannya, cara daftar
// aktif dan riwayat menerapkannya, server tiruan yang menerima penandaan, dan
// keadaan store yang harus tetap sama dengan keadaan sebenarnya.

const WEEK = ALERT_HISTORY_SECONDS;

const handledMap = (...records: HandledRecord[]): HandledMap =>
  new Map(records.map((record) => [record.id, record]));

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

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

// Waktu selesai alami satu alert (tanpa catatan ditangani). Alert paling lama
// 80 menit, jadi empat jam sesudah `around` pasti sudah selesai.
function naturalEnd(id: string, around: number) {
  const found = mockResolvedAlerts(around + 4 * 3_600, WEEK).find(
    (alert) => alert.id === id,
  );
  if (!found) throw new Error(`${id} tidak selesai dalam empat jam`);
  return found.endedAt;
}

// Alert aktif pertama pada `t` yang baru selesai alami paling cepat dua menit
// lagi, supaya uji yang menggeser waktu beberapa detik tidak kebetulan berhenti.
function longLived(t: number) {
  const found = mockActiveAlerts(t).find(
    (alert) => naturalEnd(alert.id, t) > t + 120,
  );
  if (!found) throw new Error("tidak ada alert aktif yang cukup lama");
  return found;
}

function expectOk(result: HandleAlertResult) {
  if (!result.ok) throw new Error(`ditolak: ${result.reason}`);
  return result.alert;
}

test.describe("catatan alert yang ditandai ditangani", () => {
  const good = { id: "alert-1", at: START, by: "Budi" };

  test("parseHandled membaca yang sah dan membuang yang rusak satu per satu", () => {
    expect([...parseHandled(JSON.stringify([good])).values()]).toEqual([good]);
    for (const empty of [null, undefined, "", "{bukan json", '{"id":"a"}']) {
      expect(parseHandled(empty).size, String(empty)).toBe(0);
    }
    const invalid = [
      { id: "", at: 5, by: "x" },
      { id: "a", at: 0, by: "x" },
      { id: "a", at: -3, by: "x" },
      { id: "a", at: 1.5, by: "x" },
      { id: "a", at: "5", by: "x" },
      { id: "a", at: 5, by: "  " },
      { id: "a", at: 5 },
      { id: 7, at: 5, by: "x" },
      null,
      "teks",
      12,
    ];
    const parsed = parseHandled(
      JSON.stringify([
        ...invalid,
        good,
        { ...good, id: "alert-2", tambahan: "tidak ikut" },
      ]),
    );
    expect([...parsed.keys()].sort()).toEqual(["alert-1", "alert-2"]);
    expect(parsed.get("alert-2")).toEqual({ ...good, id: "alert-2" });
  });

  test("serializeHandled dan parseHandled bolak-balik tanpa kehilangan isi", () => {
    const map = handledMap(good, { id: "alert-2", at: START + 9, by: "Sari" });
    expect([...parseHandled(serializeHandled(map)).entries()]).toEqual([
      ...map.entries(),
    ]);
  });

  test("pruneHandled membuang yang lewat masa simpan, tegas di batasnya, dan mengembalikan peta yang sama bila tidak ada", () => {
    const old = { id: "lama", at: 1_000, by: "x" };
    const fresh = {
      id: "baru",
      at: 1_000 + HANDLED_RETENTION_SECONDS,
      by: "x",
    };
    const map = handledMap(old, fresh);
    const edge = 1_000 + HANDLED_RETENTION_SECONDS;
    expect([...pruneHandled(map, edge).keys()]).toEqual(["baru"]);
    // Sedetik sebelum batas, belum ada yang kedaluwarsa: peta yang sama.
    expect(pruneHandled(map, edge - 1)).toBe(map);
    expect(pruneHandled(noHandled, edge)).toBe(noHandled);
  });

  test("registry menyimpan lewat penyimpanan, dilihat registry lain yang memakai penyimpanan yang sama, dan objeknya stabil", () => {
    const storage = memoryStorage();
    const options = { storage: () => storage, now: () => START };
    const first = createHandledRegistry(options);
    expect(first.all().size).toBe(0);
    first.add(good);
    // Tab lain: registry baru dengan penyimpanan yang sama.
    const second = createHandledRegistry(options);
    expect(second.all().get(good.id)).toEqual(good);
    // Objek yang sama dikembalikan sampai isinya berubah, juga oleh yang menulis.
    expect(second.all()).toBe(second.all());
    expect(first.all()).toBe(first.all());
    const sari = { id: "alert-2", at: START, by: "Sari" };
    second.add(sari);
    expect([...first.all().keys()].sort()).toEqual(["alert-1", "alert-2"]);
    // Catatan baru untuk id yang sama mengganti yang lama.
    first.add({ ...good, by: "Dewi" });
    expect(second.all().get(good.id)?.by).toBe("Dewi");
    expect(second.all().size).toBe(2);
  });

  test("catatan yang sudah lewat masa simpan tidak ikut dibaca dan tidak ikut disimpan", () => {
    const storage = memoryStorage();
    const old = { id: "lama", at: START - HANDLED_RETENTION_SECONDS, by: "x" };
    storage.data.set("alertHandled", JSON.stringify([old, good]));
    const registry = createHandledRegistry({
      storage: () => storage,
      now: () => START,
    });
    expect([...registry.all().keys()]).toEqual([good.id]);
    registry.add({ id: "alert-3", at: START, by: "Sari" });
    expect(parseHandled(storage.data.get("alertHandled")).has("lama")).toBe(
      false,
    );
  });

  test("penyimpanan yang diblokir atau penuh tidak merusak apa pun: catatan berlaku di sesi ini saja", () => {
    const blocked = () => {
      throw new Error("diblokir");
    };
    const unreadable = createHandledRegistry({
      storage: () => ({ getItem: blocked, setItem: blocked }),
      now: () => START,
    });
    expect(unreadable.all().size).toBe(0);
    unreadable.add(good);
    expect(unreadable.all().get(good.id)).toEqual(good);

    const missing = createHandledRegistry({
      storage: () => null,
      now: () => START,
    });
    missing.add(good);
    expect(missing.all().get(good.id)).toEqual(good);

    // Bisa dibaca tetapi tidak bisa ditulis (penuh): catatan tetap ada di memori,
    // juga sesudah dibaca ulang, dan yang berikutnya ikut.
    const storage = memoryStorage();
    const full = createHandledRegistry({
      storage: () => ({
        getItem: storage.getItem,
        setItem: blocked,
      }),
      now: () => START,
    });
    full.add(good);
    expect(full.all().get(good.id)).toEqual(good);
    full.add({ id: "alert-2", at: START, by: "Sari" });
    expect([...full.all().keys()].sort()).toEqual(["alert-1", "alert-2"]);
  });
});

test.describe("daftar aktif dan riwayat dengan alert yang ditandai", () => {
  test("tanpa catatan, hasilnya persis sama dengan sebelum fitur ini", () => {
    const { mixed } = findMoments();
    expect(
      difference(
        mockActiveAlerts(mixed.t, noHandled),
        mockActiveAlerts(mixed.t),
      ),
    ).toBe("sama");
    expect(
      difference(
        mockResolvedAlerts(mixed.t, WEEK, noHandled),
        mockResolvedAlerts(mixed.t),
      ),
    ).toBe("sama");
    const resolved = mockResolvedAlerts(mixed.t);
    expect(resolved.length).toBeGreaterThan(50);
    expect(resolved.every((alert) => alert.handledBy === null)).toBe(true);
    expect(resolved.every((alert) => alert.endTimeSource !== "operator")).toBe(
      true,
    );
  });

  test("alert yang ditandai keluar dari daftar aktif dan masuk riwayat pada saat penandaan, dengan isian lain tidak berubah", () => {
    const { mixed } = findMoments();
    const t = mixed.t;
    const before = mockActiveAlerts(t);
    const target = before[0];
    const handled = handledMap({ id: target.id, at: t, by: "Budi" });

    const active = mockActiveAlerts(t, handled);
    expect(active.map((alert) => alert.id)).toEqual(
      before.filter((alert) => alert.id !== target.id).map((alert) => alert.id),
    );

    const resolved = mockResolvedAlerts(t, WEEK, handled);
    const entry = resolved.find((alert) => alert.id === target.id);
    expect(entry).toBeDefined();
    expect(entry!.endedAt).toBe(t);
    expect(entry!.endTimeSource).toBe("operator");
    expect(entry!.endTimeUncertaintySeconds).toBe(0);
    expect(entry!.handledBy).toBe("Budi");
    // Yang berubah hanya isian selesai; sisanya sama dengan saat masih aktif.
    for (const key of [
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
    ] as const) {
      expect(entry![key], key).toEqual(target[key]);
    }
    expect(entry!.location).toEqual(target.location);
    // Riwayat lain tidak berubah.
    expect(
      difference(
        resolved.filter((alert) => alert.id !== target.id),
        mockResolvedAlerts(t, WEEK),
      ),
    ).toBe("sama");
    expect(
      difference(resolved, sortResolvedAlerts(resolved)),
      "urutan riwayat",
    ).toBe("sama");
  });

  test("setelah waktu selesai alaminya lewat, riwayat tetap memuat penandaan petugas, satu kali", () => {
    const { mixed } = findMoments();
    const target = mockActiveAlerts(mixed.t)[0];
    const natural = naturalEnd(target.id, mixed.t);
    const handled = handledMap({ id: target.id, at: mixed.t, by: "Budi" });
    for (const u of [natural - 1, natural, natural + 1, natural + 3_600]) {
      const resolved = mockResolvedAlerts(u, WEEK, handled).filter(
        (alert) => alert.id === target.id,
      );
      expect(resolved.length, `@${u}`).toBe(1);
      expect(resolved[0].endedAt).toBe(mixed.t);
      expect(resolved[0].handledBy).toBe("Budi");
      expect(
        mockActiveAlerts(u, handled).some((alert) => alert.id === target.id),
      ).toBe(false);
    }
  });

  test("catatan yang tidak masuk akal diabaikan: sebelum terdeteksi, pada atau sesudah waktu selesai alami, atau belum terjadi", () => {
    const { mixed } = findMoments();
    const t = mixed.t;
    const target = longLived(t);
    const natural = naturalEnd(target.id, t);
    const baseActive = mockActiveAlerts(t);
    const record = (at: number) => handledMap({ id: target.id, at, by: "X" });

    for (const [name, at, now] of [
      ["sebelum terdeteksi", target.detectedAt - 1, t],
      ["tepat pada waktu selesai alami", natural, natural],
      ["sesudah waktu selesai alami", natural + 5, natural + 10],
      ["belum terjadi", t + 100, t],
    ] as const) {
      const handled = record(at);
      expect(
        difference(mockActiveAlerts(now, handled), mockActiveAlerts(now)),
        `${name}: aktif`,
      ).toBe("sama");
      expect(
        difference(
          mockResolvedAlerts(now, WEEK, handled),
          mockResolvedAlerts(now),
        ),
        `${name}: riwayat`,
      ).toBe("sama");
    }
    // Batas yang sah: tepat saat terdeteksi dan sedetik sebelum selesai alami.
    for (const at of [target.detectedAt, natural - 1]) {
      const handled = record(at);
      expect(
        mockActiveAlerts(at, handled).some((alert) => alert.id === target.id),
        `@${at} aktif`,
      ).toBe(false);
      const entry = mockResolvedAlerts(at, WEEK, handled).find(
        (alert) => alert.id === target.id,
      );
      expect(entry?.endedAt, `@${at} riwayat`).toBe(at);
    }
    // Yang belum terjadi baru berlaku saat waktunya tiba.
    const future = record(t + 100);
    expect(
      mockActiveAlerts(t + 99, future).some((a) => a.id === target.id),
    ).toBe(true);
    expect(
      mockActiveAlerts(t + 100, future).some((a) => a.id === target.id),
    ).toBe(false);
    expect(baseActive.some((a) => a.id === target.id)).toBe(true);
  });

  test("sepanjang dua hari dengan penandaan acak, satu alert ada di tepat satu daftar dan tidak ada yang hilang atau bertambah", () => {
    const records: HandledRecord[] = [];
    let handled: HandledMap = noHandled;
    // Seperti di dunia nyata: hanya alert yang sedang aktif yang bisa ditandai.
    for (let step = 0; step < 192; step += 1) {
      const t = START + step * 900;
      for (const [index, alert] of mockActiveAlerts(t, handled).entries()) {
        if (unit(step * 1_009 + index * 31 + 7) < 0.4) {
          records.push({ id: alert.id, at: t, by: `Petugas ${step % 3}` });
        }
      }
      handled = handledMap(...records);
    }
    expect(records.length).toBeGreaterThan(20);

    const problems: string[] = [];
    let handledSeen = 0;
    let afterNatural = 0;
    for (let step = 0; step < 120; step += 1) {
      const u = START + step * 1_800 + 450;
      const active = mockActiveAlerts(u, handled);
      const resolved = mockResolvedAlerts(u, WEEK, handled);
      const baseIds = new Set(
        [...mockActiveAlerts(u), ...mockResolvedAlerts(u, WEEK)].map(
          (alert) => alert.id,
        ),
      );
      const activeIds = new Set(active.map((alert) => alert.id));
      const resolvedIds = new Set(resolved.map((alert) => alert.id));
      if (resolvedIds.size !== resolved.length)
        problems.push(`@${u}: id ganda di riwayat`);
      const both = [...activeIds].filter((id) => resolvedIds.has(id));
      if (both.length > 0) problems.push(`@${u}: di dua daftar ${both[0]}`);
      const union = new Set([...activeIds, ...resolvedIds]);
      if (union.size !== baseIds.size)
        problems.push(`@${u}: ${union.size} alert, seharusnya ${baseIds.size}`);
      for (const id of baseIds) {
        if (!union.has(id)) {
          problems.push(`@${u}: ${id} hilang`);
          break;
        }
      }
      for (const alert of resolved) {
        const record = handled.get(alert.id);
        const applies = record !== undefined && record.at <= u;
        if (applies) {
          handledSeen += 1;
          if (
            alert.endedAt !== record.at ||
            alert.handledBy !== record.by ||
            alert.endTimeSource !== "operator" ||
            alert.endTimeUncertaintySeconds !== 0
          )
            problems.push(`@${u}: ${alert.id} salah dicatat`);
          if (record.at < u - 4 * 3_600) afterNatural += 1;
        } else if (
          alert.handledBy !== null ||
          alert.endTimeSource === "operator"
        ) {
          problems.push(`@${u}: ${alert.id} bukan ditangani tetapi bertanda`);
        }
      }
      if (difference(resolved, sortResolvedAlerts(resolved)) !== "sama")
        problems.push(`@${u}: urutan riwayat`);
    }
    expect(problems).toEqual([]);
    // Pengujiannya bermakna: banyak penandaan terlihat, juga yang sudah lama.
    expect(handledSeen).toBeGreaterThan(500);
    expect(afterNatural).toBeGreaterThan(100);
  });
});

test.describe("sumber data hub tiruan", () => {
  test("memakai catatan yang diberikan tiap dipanggil: aktif tanpa yang ditandai, riwayat memuatnya, dan perubahan catatan langsung terlihat", () => {
    const { mixed } = findMoments();
    const t = mixed.t;
    const target = mockActiveAlerts(t)[0];
    let handled: HandledMap = noHandled;
    const source = createMockAlertSource(() => handled);
    expect(source.active(t).some((a) => a.id === target.id)).toBe(true);
    expect(source.resolved(t, WEEK).some((a) => a.id === target.id)).toBe(
      false,
    );
    // Catatan berubah di antara dua panggilan (tab lain menandai).
    handled = handledMap({ id: target.id, at: t, by: "Rahmat Hidayat" });
    expect(source.active(t).some((a) => a.id === target.id)).toBe(false);
    const entry = source.resolved(t, WEEK).find((a) => a.id === target.id);
    expect(entry?.handledBy).toBe("Rahmat Hidayat");
    // Jendela resolved dihormati: catatan tidak mengubah isinya di luar jendela.
    expect(source.resolved(t, 1).some((a) => a.id === target.id)).toBe(true);
    expect(source.resolved(t + 10, 5).some((a) => a.id === target.id)).toBe(
      false,
    );
  });
});

test.describe("pemuat REST tiruan", () => {
  test("masa simpan catatan sama dengan jendela riwayat, supaya tidak ada catatan yang dibuang selagi alertnya masih tampil", () => {
    expect(HANDLED_RETENTION_SECONDS).toBe(ALERT_HISTORY_SECONDS);
  });

  test("daftar aktif, riwayat, dan keduanya sekaligus memakai catatan yang sama, tanpa tumpang tindih", async () => {
    const { mixed } = findMoments();
    const target = mockActiveAlerts(mixed.t)[0];
    const handled = handledMap({
      id: target.id,
      at: mixed.t,
      by: "Rahmat Hidayat",
    });
    const active = await loadActiveAlerts(mixed.t, handled);
    const resolved = await loadResolvedAlerts(mixed.t, WEEK, handled);
    expect(difference(active, mockActiveAlerts(mixed.t, handled))).toBe("sama");
    expect(
      difference(resolved, mockResolvedAlerts(mixed.t, WEEK, handled)),
    ).toBe("sama");
    expect(active.some((alert) => alert.id === target.id)).toBe(false);
    expect(resolved.find((alert) => alert.id === target.id)?.handledBy).toBe(
      "Rahmat Hidayat",
    );

    const lists = await loadAlertLists(mixed.t, handled);
    expect(difference(lists.active, active)).toBe("sama");
    expect(difference(lists.resolved, resolved)).toBe("sama");
    // Tanpa catatan: seperti sebelum fitur ini.
    const plain = await loadAlertLists(mixed.t, noHandled);
    expect(plain.active.some((alert) => alert.id === target.id)).toBe(true);
    expect(plain.resolved.some((alert) => alert.id === target.id)).toBe(false);
  });
});

test.describe("server tiruan untuk tandai ditangani", () => {
  function server(
    startNow: number,
    options: { latencyMs?: number; online?: boolean } = {},
  ) {
    const storage = memoryStorage();
    let now = startNow;
    const state = { online: options.online ?? true };
    const registry = createHandledRegistry({
      storage: () => storage,
      now: () => now,
    });
    const waits: number[] = [];
    const actions = createMockAlertActions({
      registry,
      now: () => now,
      isOnline: () => state.online,
      latencyMs: options.latencyMs ?? 0,
      wait: async (ms) => {
        waits.push(ms);
        now += Math.round(ms / 1_000);
      },
    });
    return {
      registry,
      actions,
      waits,
      state,
      getNow: () => now,
    };
  }

  test("menerima alert aktif: mencatat siapa dan kapan, dan menjawab dengan baris riwayat yang sama dengan yang dikirim hub", async () => {
    const { mixed } = findMoments();
    const t = mixed.t;
    const target = mockActiveAlerts(t)[0];
    const s = server(t);
    const alert = expectOk(await s.actions.handle(target.id, "Rahmat Hidayat"));

    expect(s.registry.all().get(target.id)).toEqual({
      id: target.id,
      at: t,
      by: "Rahmat Hidayat",
    });
    // Jawabannya persis baris riwayat yang dihitung dari catatan yang sama.
    const fromLists = mockResolvedAlerts(t, WEEK, s.registry.all()).find(
      (candidate) => candidate.id === target.id,
    );
    expect(JSON.stringify(alert)).toBe(JSON.stringify(fromLists));
    expect(alert.endedAt).toBe(t);
    expect(alert.handledBy).toBe("Rahmat Hidayat");
    expect(alert.endTimeSource).toBe("operator");
    expect(
      mockActiveAlerts(t, s.registry.all()).some((a) => a.id === target.id),
    ).toBe(false);
    // Tanpa latensi, "server" tidak menunggu apa pun.
    expect(s.waits).toEqual([]);
  });

  test("alert yang sudah ditandai, tidak dikenal, atau sudah selesai ditolak tanpa mengubah catatan", async () => {
    const { mixed } = findMoments();
    const t = mixed.t;
    const first = mockActiveAlerts(t)[0];
    const finished = mockResolvedAlerts(t)[0];
    const s = server(t);
    expectOk(await s.actions.handle(first.id, "Budi"));
    const snapshot = serializeHandled(s.registry.all());

    // Petugas lain menekan tombol yang sama sedetik kemudian; id yang tidak
    // dikenal; dan alert yang sudah selesai sendiri.
    for (const id of [first.id, "alert-tidak-ada", "", finished.id]) {
      const result = await s.actions.handle(id, "Sari");
      expect(result.ok, id).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("not-active");
        expect(result.message).toBe(handleFailureMessages["not-active"]);
      }
    }
    expect(serializeHandled(s.registry.all())).toBe(snapshot);
  });

  test("dinilai saat permintaan DIPROSES: alert yang selesai selama permintaan berjalan ditolak", async () => {
    const { mixed } = findMoments();
    const target = mockActiveAlerts(mixed.t)[0];
    const natural = naturalEnd(target.id, mixed.t);
    // Menekan konfirmasi 30 detik sebelum selesai, permintaan sampai 60 detik kemudian.
    const s = server(natural - 30, { latencyMs: 60_000 });
    const result = await s.actions.handle(target.id, "Budi");
    expect(s.waits).toEqual([60_000]);
    expect(s.getNow()).toBe(natural + 30);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not-active");
    expect(s.registry.all().size).toBe(0);

    // Dengan latensi lebih pendek dari sisa waktunya, alert masih aktif dan diterima.
    const quick = server(natural - 30, { latencyMs: 10_000 });
    const alert = expectOk(await quick.actions.handle(target.id, "Budi"));
    expect(alert.endedAt).toBe(natural - 20);
  });

  test("tanpa koneksi permintaan tidak sampai ke server: tidak menunggu, tidak mencatat, dan boleh dicoba lagi", async () => {
    const { mixed } = findMoments();
    const target = mockActiveAlerts(mixed.t)[0];
    const s = server(mixed.t, { latencyMs: 300, online: false });
    const offline = await s.actions.handle(target.id, "Budi");
    expect(offline.ok).toBe(false);
    if (!offline.ok) {
      expect(offline.reason).toBe("offline");
      expect(offline.message).toBe(handleFailureMessages.offline);
    }
    expect(s.waits).toEqual([]);
    expect(s.registry.all().size).toBe(0);

    s.state.online = true;
    const alert = expectOk(await s.actions.handle(target.id, "Budi"));
    expect(s.waits).toEqual([300]);
    expect(alert.id).toBe(target.id);
  });

  test("nama petugas yang kosong dicatat sebagai Petugas, dan spasi di tepinya dibuang", async () => {
    const { mixed } = findMoments();
    const [first, second] = mockActiveAlerts(mixed.t);
    const s = server(mixed.t);
    expect(expectOk(await s.actions.handle(first.id, "   ")).handledBy).toBe(
      "Petugas",
    );
    expect(
      expectOk(await s.actions.handle(second.id, "  Sari  ")).handledBy,
    ).toBe("Sari");
  });
});

test.describe("store alert dengan penandaan", () => {
  // Dunia kecil: catatan di memori, server tiruan yang memakainya, hub yang
  // membacanya, dan keadaan seperti di store (snapshot, pesan hub, dan jawaban
  // server yang diterapkan lewat handledState).
  function world(startAt: number) {
    let now = startAt;
    const registry = createHandledRegistry({
      storage: () => null,
      now: () => now,
    });
    const source = createMockAlertSource(() => registry.all());
    const hub = createMockAlertHub(source);
    const actions = createMockAlertActions({
      registry,
      now: () => now,
      isOnline: () => true,
      latencyMs: 0,
    });
    let state: AlertState = snapshotState(
      emptyAlertState,
      hub.snapshot(now),
      now,
    );
    return {
      registry,
      getNow: () => now,
      getState: () => state,
      truth: () => ({
        active: source.active(now),
        resolved: source.resolved(now, WEEK),
      }),
      advance(seconds: number) {
        now += seconds;
        const message = hub.changes(now);
        state = message
          ? messageState(state, message, now)
          : { ...state, updatedAt: now };
        state = {
          ...state,
          resolved: state.resolved && pruneResolved(state.resolved, now),
        };
      },
      // Petugas menekan konfirmasi: jawaban server diterapkan seperti di store.
      async handle(id: string, operator: string) {
        const result = await actions.handle(id, operator);
        if (result.ok) state = handledState(state, result.alert, now);
        return result;
      },
    };
  }

  test("handledState memindahkan alert dari aktif ke puncak riwayat dalam satu pembaruan, menjaga objek lain", async () => {
    const { mixed } = findMoments();
    const w = world(mixed.t);
    const before = w.getState();
    const target = before.active![0];
    const result = await w.handle(target.id, "Budi");
    expect(result.ok).toBe(true);
    const after = w.getState();

    expect(after.active!.map((a) => a.id)).toEqual(
      before.active!.slice(1).map((a) => a.id),
    );
    // Yang tidak tersentuh tetap objek yang sama.
    after.active!.forEach((alert, index) =>
      expect(alert).toBe(before.active![index + 1]),
    );
    const entry = after.resolved!.find((a) => a.id === target.id)!;
    expect(entry.endedAt).toBe(mixed.t);
    expect(after.resolved!.length).toBe(before.resolved!.length + 1);
    // Tidak di dua daftar sekaligus.
    expect(after.active!.some((a) => a.id === target.id)).toBe(false);
    // Yang selesai paling akhir di atas; yang lain di bawahnya tidak berubah.
    expect(
      difference(after.resolved, sortResolvedAlerts(after.resolved!)),
    ).toBe("sama");
    after.resolved!.forEach((alert) => {
      if (alert.id === target.id) return;
      expect(before.resolved!.includes(alert)).toBe(true);
    });
  });

  test("menerapkan jawaban yang sama dua kali, atau sesudah pesan hub yang memuatnya, tidak mengubah apa pun", async () => {
    const { mixed } = findMoments();
    const w = world(mixed.t);
    const target = w.getState().active![0];
    const alert = expectOk(
      await createMockAlertActions({
        registry: w.registry,
        now: () => mixed.t,
        isOnline: () => true,
        latencyMs: 0,
      }).handle(target.id, "Budi"),
    );
    const once = handledState(w.getState(), alert, mixed.t);
    expect(handledState(once, alert, mixed.t)).toBe(once);

    // Pesan hub dari hub lain (tab lain) memuat alert yang sama di `ended`.
    const otherHub = createMockAlertHub(
      createMockAlertSource(() => w.registry.all()),
    );
    otherHub.snapshot(mixed.t - 1);
    const next = otherHub.changes(mixed.t);
    expect(next?.ended.some((a) => a.id === target.id)).toBe(true);
    const merged = messageState(once, next!, mixed.t);
    expect(merged.resolved!.filter((a) => a.id === target.id).length).toBe(1);
    // Dan jawaban yang datang SESUDAH pesan itu tidak menggandakan baris.
    const late = handledState(merged, alert, mixed.t);
    expect(late.resolved).toBe(merged.resolved);
    expect(late.active).toBe(merged.active);
  });

  test("sebelum daftar diterima handledState tidak mengarang apa pun, dan alert yang tidak aktif tidak mengubah keadaan", async () => {
    const { mixed } = findMoments();
    const w = world(mixed.t);
    const target = w.getState().active![0];
    const alert = expectOk(await w.handle(target.id, "Budi"));
    expect(handledState(emptyAlertState, alert, mixed.t)).toBe(emptyAlertState);
    // Riwayat belum ada: hanya daftar aktif yang dipakai.
    const activeOnly: AlertState = {
      active: mockActiveAlerts(mixed.t),
      resolved: null,
      updatedAt: mixed.t,
    };
    const next = handledState(activeOnly, alert, mixed.t + 1);
    expect(next.resolved).toBeNull();
    expect(next.active!.some((a) => a.id === target.id)).toBe(false);
    // Alert yang tidak ada di aktif dan sudah ada di riwayat: keadaan yang sama.
    expect(handledState(w.getState(), alert, mixed.t)).toBe(w.getState());
  });

  test("dengan penandaan acak di antara langkah waktu acak, keadaan selalu sama dengan keadaan sebenarnya setelah pesan hub berikutnya", async () => {
    let handledCount = 0;
    let steps = 0;
    for (const seed of [1, 2, 3]) {
      const w = world(START + seed * 7_919);
      for (let step = 0; step < 300; step += 1) {
        w.advance(1 + Math.floor(unit(seed * 100_003 + step) * 90));
        steps += 1;
        // Petugas menekan konfirmasi pada alert yang sedang tampil, di detik yang
        // sama dengan pemeriksaan hub (catatan ditulis SESUDAH pemeriksaan).
        const active = w.getState().active!;
        if (active.length > 0 && unit(seed * 7_001 + step * 13) < 0.35) {
          const pick =
            active[Math.floor(unit(seed * 31 + step * 17) * active.length)];
          const result = await w.handle(pick.id, `Petugas ${seed}`);
          expect(result.ok, `@${w.getNow()} ${pick.id}`).toBe(true);
          handledCount += 1;
          const state = w.getState();
          const ids = [...state.active!, ...state.resolved!].map((a) => a.id);
          expect(new Set(ids).size, `ganda @${w.getNow()}`).toBe(ids.length);
          expect(state.active!.some((a) => a.id === pick.id)).toBe(false);
        }
        // Satu langkah kecil: pesan hub berikutnya menyamakan sisanya.
        w.advance(1);
        const expected = w.truth();
        expect(
          difference(w.getState().active, expected.active),
          `aktif @${w.getNow()}`,
        ).toBe("sama");
        expect(
          difference(w.getState().resolved, expected.resolved),
          `riwayat @${w.getNow()}`,
        ).toBe("sama");
      }
    }
    expect(steps).toBe(900);
    expect(handledCount).toBeGreaterThan(30);
  });

  test("penandaan dari tab lain (hanya lewat catatan) sampai lewat hub bila ditulis sebelum pemeriksaan", () => {
    const { mixed } = findMoments();
    const w = world(mixed.t);
    const target = longLived(mixed.t);
    // Tab lain menulis catatan untuk detik berikutnya; di detik itu hub memeriksa.
    w.registry.add({ id: target.id, at: mixed.t + 1, by: "Tab Lain" });
    w.advance(1);
    const entry = w.getState().resolved!.find((a) => a.id === target.id);
    expect(entry?.handledBy).toBe("Tab Lain");
    expect(w.getState().active!.some((a) => a.id === target.id)).toBe(false);
    const expected = w.truth();
    expect(difference(w.getState().active, expected.active)).toBe("sama");
    expect(difference(w.getState().resolved, expected.resolved)).toBe("sama");
  });

  test("sinkron ulang memuat alert yang ditandai di riwayat, dan tidak menghidupkannya kembali", async () => {
    const { mixed } = findMoments();
    const w = world(mixed.t);
    const target = w.getState().active![0];
    await w.handle(target.id, "Budi");
    const hub = createMockAlertHub(
      createMockAlertSource(() => w.registry.all()),
    );
    for (const jump of [60, 3_600, 3 * 86_400]) {
      const now = mixed.t + jump;
      const resynced = snapshotState(w.getState(), hub.snapshot(now), now);
      expect(
        resynced.active!.some((a) => a.id === target.id),
        `aktif +${jump}`,
      ).toBe(false);
      expect(
        resynced.resolved!.filter((a) => a.id === target.id).length,
        `riwayat +${jump}`,
      ).toBe(1);
    }
  });
});

test.describe("tulisan dan pencarian untuk alert yang ditandai", () => {
  const directory: SubjectDirectory = {
    routerName: () => undefined,
    customer: () => undefined,
  };

  test("describeTimeSource menyebut petugas untuk waktu selesai dari operator, dan sumber lain tidak berubah", () => {
    const operator = describeTimeSource(
      { timeSource: "operator", timeUncertaintySeconds: 0, handledBy: "Budi" },
      "end",
    );
    expect(operator.short).toBe("ditangani oleh Budi");
    expect(operator.short).toBe(describeHandled("Budi"));
    expect(operator.long).toContain("Budi");
    expect(operator.long).toContain("tepat sampai detik");
    expect(operator.long).toContain("bukan saat jaringan terbukti pulih");
    // Tanpa nama, tetap kalimat yang utuh.
    for (const handledBy of [null, undefined, "  "]) {
      expect(
        describeTimeSource(
          { timeSource: "operator", timeUncertaintySeconds: 0, handledBy },
          "end",
        ).short,
      ).toBe("ditangani oleh petugas");
    }
    expect(
      describeTimeSource(
        { timeSource: "event", timeUncertaintySeconds: 0 },
        "end",
      ).short,
    ).toBe("dari router");
    expect(
      describeTimeSource(
        { timeSource: "poll", timeUncertaintySeconds: 30 },
        "end",
      ).short,
    ).toBe("polling ±30 detik");
  });

  function sampleHistory() {
    const { mixed } = findMoments();
    const active = mockActiveAlerts(mixed.t);
    const handled = handledMap(
      { id: active[0].id, at: mixed.t, by: "Rahmat Hidayat" },
      { id: active[1].id, at: mixed.t, by: "Wulan Pratiwi" },
    );
    return {
      now: mixed.t,
      ids: [active[0].id, active[1].id],
      list: mockResolvedAlerts(mixed.t, WEEK, handled),
    };
  }

  test("pencarian menemukan alert yang ditandai lewat kata ditangani dan nama petugas, dan hanya itu", () => {
    const { now, ids, list } = sampleHistory();
    const find = (query: string) =>
      filterResolvedAlerts(
        list,
        { ...defaultResolvedFilters, query },
        now,
        directory,
      )
        .map((alert) => alert.id)
        .sort();
    expect(find("ditangani")).toEqual([...ids].sort());
    expect(find("ditangani oleh")).toEqual([...ids].sort());
    expect(find("rahmat")).toEqual([ids[0]]);
    expect(find("Hidayat ditangani")).toEqual([ids[0]]);
    expect(find("pratiwi")).toEqual([ids[1]]);
    expect(find("ditangani oleh wulan")).toEqual([ids[1]]);
    expect(find("rahmat wulan")).toEqual([]);
    expect(find("tidak ada petugas ini")).toEqual([]);
    // Alert yang berhenti sendiri tidak punya tulisan itu.
    const natural = list.find((alert) => alert.handledBy === null)!;
    expect(searchableText(natural, directory)).not.toContain("ditangani");
  });

  test("angka di tiap pilihan tetap sama dengan hasil saringan saat ada alert yang ditandai", () => {
    const { now, list } = sampleHistory();
    for (const query of [
      "",
      "ditangani",
      "rahmat",
      "wulan pratiwi",
      "polling",
    ]) {
      for (const kind of ["all", "offline", "queue"] as const) {
        const filters = { ...defaultResolvedFilters, query, kind };
        const shown = filterResolvedAlerts(list, filters, now, directory);
        const counts = resolvedFacetCounts(list, filters, now, directory, []);
        expect(counts.total, `${query}/${kind}`).toBe(shown.length);
      }
    }
  });

  test("sebelum ditandai tidak ada alert yang cocok dengan kata ditangani", () => {
    const { mixed } = findMoments();
    const list: ResolvedAlert[] = mockResolvedAlerts(mixed.t);
    expect(
      filterResolvedAlerts(
        list,
        { ...defaultResolvedFilters, query: "ditangani" },
        mixed.t,
        directory,
      ),
    ).toEqual([]);
  });
});
