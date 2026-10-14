import { expect, test } from "@playwright/test";
import {
  AUDIT_MOCK_START,
  AUDIT_SYSTEM_ACTOR,
  auditActionList,
  auditOperators,
  buildAuditEntry,
  changed,
  mockAuditLog,
  redacted,
  type AuditAction,
  type AuditActor,
  type AuditEntry,
  type AuditEntryInput,
} from "../src/lib/dashboard/audit";
import {
  AUDIT_QUERY_PREVIEW_MAX,
  actorOptions,
  auditFacetCounts,
  auditSearchableText,
  auditWithinSeconds,
  describeFilter,
  emptyAuditFilter,
  filterAudit,
  isFilterActive,
  matches,
  normalize,
  searchTerms,
  type AuditFilter,
  type AuditWithin,
} from "../src/lib/dashboard/audit-filter";

// Pencarian dan saringan jejak aktivitas (audit-filter.ts), tanpa browser:
// kasus tangan untuk teks, aksi, petugas, dan batas waktu sampai detik; identitas
// array hasil; pilihan petugas; kalimat saringan; lalu uji acak dengan seed tetap
// yang membandingkan semuanya, termasuk angka di samping tiap pilihan, dengan
// pemeriksa referensi yang ditulis lagi di sini dengan cara paling lugas (tanpa
// memakai matches, normalize, atau auditSearchableText).

const DAY = 86_400;
const NOW = AUDIT_MOCK_START + 100 * DAY + 13 * 3_600 + 17;
// Waktu tetap untuk catatan buatan tangan.
const T = 2_000_000_000;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// expect() di dalam putaran besar sangat lambat, jadi pelanggaran dikumpulkan
// dan dinilai sekali di akhir.
function collector() {
  const found: string[] = [];
  return {
    check(ok: boolean, message: string) {
      if (!ok) found.push(message);
    },
    done() {
      expect(found.slice(0, 10)).toEqual([]);
    },
  };
}

const ANDI = auditOperators[0];
const SITI = auditOperators[1];
const BAYU = auditOperators[2];
const RATNA = auditOperators[3];

function make(
  id: string,
  at: number,
  partial: Partial<AuditEntryInput> = {},
): AuditEntry {
  return buildAuditEntry({
    id,
    at,
    actor: ANDI,
    action: "login",
    target: "Akun Andi Prasetyo",
    summary: "Andi Prasetyo masuk ke dasbor NOC.",
    ...partial,
  });
}

// Enam catatan dengan isi yang berbeda-beda, terbaru di atas.
const e1 = make("e1", T - 60, {
  action: "router-updated",
  target: "Router RTR-Pusat-01",
  summary: "Andi Prasetyo mengubah alamat router RTR-Pusat-01.",
  changes: [changed("Alamat router", "10.0.0.1", "10.20.0.5")],
});
const e2 = make("e2", T - 120, {
  actor: SITI,
  action: "router-updated",
  target: "Router RTR-Pusat-01",
  summary: "Siti Nurhaliza mengganti kata sandi router RTR-Pusat-01.",
  changes: [redacted("Kata sandi router")],
});
const e3 = make("e3", T - 3_000);
const e4 = make("e4", T - 5_000, {
  actor: AUDIT_SYSTEM_ACTOR,
  action: "billing-sync",
  target: "Sinkron billing",
  summary:
    "Sinkron billing otomatis selesai: 100 tagihan terbaca, 99 cocok, 1 belum cocok.",
});
const e5 = make("e5", T - 80_000, {
  actor: BAYU,
  action: "cpe-changed",
  target: "Pelanggan Budi Santoso",
  summary: "Bayu Kurniawan mengganti SSID dan kata sandi Wi-Fi Budi Santoso.",
  changes: [
    changed("SSID Wi-Fi", "Budi-Home", "Budi-Net"),
    redacted("Kata sandi Wi-Fi"),
  ],
});
const e6 = make("e6", T - 500_000, {
  actor: RATNA,
  action: "settings-changed",
  target: "Penyimpanan data",
  summary: "Ratna Wulandari mengubah lama penyimpanan data trafik.",
  changes: [changed("Retensi data trafik", "30 hari", "60 hari")],
});
const fixture: readonly AuditEntry[] = [e1, e2, e3, e4, e5, e6];

const ids = (list: readonly AuditEntry[]) => list.map((entry) => entry.id);
const filterBy = (
  partial: Partial<AuditFilter>,
  list: readonly AuditEntry[] = fixture,
  now = T,
) => filterAudit(list, { ...emptyAuditFilter, ...partial }, now);

// Karakter khusus ditulis lewat kode titiknya, bukan disalin ke sumber, supaya
// terbaca jelas dan tidak berubah oleh editor.
const NBSP = String.fromCharCode(0xa0); // spasi tak terputus
const ACUTE = String.fromCharCode(0x301); // tanda aksen akut yang terurai
const A_ACUTE = String.fromCharCode(0xe1); // a beraksen, utuh
const E_ACUTE = String.fromCharCode(0xe9); // e beraksen, utuh
const CAP_E_ACUTE = String.fromCharCode(0xc9); // E besar beraksen, utuh

test.describe("normalisasi teks", () => {
  test("NFC, huruf kecil, dan semua jenis spasi menjadi satu spasi tanpa spasi di tepi", () => {
    // "A" + aksen terurai menjadi satu huruf beraksen, kecil.
    expect(normalize(`  A${ACUTE}  b\t\tC${NBSP} \n d  `)).toBe(
      `${A_ACUTE} b c d`,
    );
    expect(normalize("")).toBe("");
    expect(normalize(` \t${NBSP}\n `)).toBe("");
    // Huruf utuh dan terurai menjadi bentuk yang sama.
    expect(normalize(`Jose${ACUTE}`)).toBe(`jos${E_ACUTE}`);
    expect(normalize(`Jos${E_ACUTE}`)).toBe(`jos${E_ACUTE}`);
    expect(normalize(`${CAP_E_ACUTE}RIC`)).toBe(`${E_ACUTE}ric`);
  });

  test("kata kunci: dipisah spasi apa pun, kosong bila tidak ada isi", () => {
    expect(searchTerms("")).toEqual([]);
    expect(searchTerms(`  \t${NBSP}  `)).toEqual([]);
    expect(searchTerms(`Router   ANDI\tkata${NBSP}sandi`)).toEqual([
      "router",
      "andi",
      "kata",
      "sandi",
    ]);
  });
});

test.describe("teks yang dicari", () => {
  test("persis yang dijelaskan baris: petugas, aksi, kelompok, objek, ringkasan, dan tiap perubahan", () => {
    expect(auditSearchableText(e2)).toBe(
      "siti nurhaliza router diubah perangkat router rtr-pusat-01 siti nurhaliza mengganti kata sandi router rtr-pusat-01. kata sandi router: nilai disembunyikan",
    );
    expect(auditSearchableText(e1)).toBe(
      "andi prasetyo router diubah perangkat router rtr-pusat-01 andi prasetyo mengubah alamat router rtr-pusat-01. alamat router: dari 10.0.0.1 ke 10.20.0.5",
    );
    expect(auditSearchableText(e4)).toBe(
      "sistem sinkron billing pengaturan sinkron billing sinkron billing otomatis selesai: 100 tagihan terbaca, 99 cocok, 1 belum cocok.",
    );
    // Dua perubahan: keduanya tertulis, yang rahasia tanpa nilai.
    expect(auditSearchableText(e5)).toBe(
      "bayu kurniawan cpe pelanggan diubah perangkat pelanggan budi santoso bayu kurniawan mengganti ssid dan kata sandi wi-fi budi santoso. ssid wi-fi: dari budi-home ke budi-net kata sandi wi-fi: nilai disembunyikan",
    );
  });

  test("id catatan tidak ikut dicari, di data buatan maupun tiruan", () => {
    const sample = make("zq-unik-77", T - 10);
    expect(auditSearchableText(sample)).not.toContain("zq-unik-77");
    expect(filterBy({ query: "zq-unik-77" }, [sample])).toEqual([]);
    expect(filterBy({ query: "zq-unik" }, [sample])).toEqual([]);
    const entries = mockAuditLog(NOW);
    for (const entry of entries.slice(0, 80)) {
      expect(auditSearchableText(entry)).not.toContain(entry.id);
    }
    expect(filterBy({ query: entries[0].id }, entries, NOW)).toEqual([]);
  });

  test("bidang rahasia: namanya bisa dicari, nilainya tidak ada untuk dicari", () => {
    expect(ids(filterBy({ query: "kata sandi" }))).toEqual(["e2", "e5"]);
    expect(ids(filterBy({ query: "sandi wi-fi" }))).toEqual(["e5"]);
    expect(ids(filterBy({ query: "disembunyikan" }))).toEqual(["e2", "e5"]);
    // Catatan rahasia tidak membawa nilai sama sekali, jadi tidak ada yang bisa
    // dicari selain nama bidangnya.
    const entries = mockAuditLog(NOW);
    let hidden = 0;
    for (const entry of entries) {
      for (const change of entry.changes) {
        if (!change.redacted) continue;
        hidden += 1;
        expect("from" in change).toBe(false);
        expect("to" in change).toBe(false);
      }
    }
    expect(hidden).toBeGreaterThan(10);
  });
});

test.describe("pencarian", () => {
  test("satu kata, juga sepotong kata, dan hanya baris yang memuatnya", () => {
    expect(ids(filterBy({ query: "router" }))).toEqual(["e1", "e2"]);
    expect(ids(filterBy({ query: "rout" }))).toEqual(["e1", "e2"]);
    expect(ids(filterBy({ query: "rtr-pusat" }))).toEqual(["e1", "e2"]);
    expect(ids(filterBy({ query: "budi" }))).toEqual(["e5"]);
    expect(ids(filterBy({ query: "10.20" }))).toEqual(["e1"]);
    // Label aksi, dan label kelompok aksi.
    expect(ids(filterBy({ query: "masuk" }))).toEqual(["e3"]);
    expect(ids(filterBy({ query: "perangkat" }))).toEqual(["e1", "e2", "e5"]);
    expect(ids(filterBy({ query: "akses" }))).toEqual(["e3"]);
    expect(ids(filterBy({ query: "pengaturan" }))).toEqual(["e4", "e6"]);
    // Nama petugas dan rincian perubahan.
    expect(ids(filterBy({ query: "ratna" }))).toEqual(["e6"]);
    expect(ids(filterBy({ query: "60 hari" }))).toEqual(["e6"]);
  });

  test("beberapa kata semuanya harus ada, dalam urutan apa pun", () => {
    expect(ids(filterBy({ query: "prasetyo router" }))).toEqual(["e1"]);
    expect(ids(filterBy({ query: "router prasetyo" }))).toEqual(["e1"]);
    expect(ids(filterBy({ query: "siti router" }))).toEqual(["e2"]);
    // Sepotong kata cukup: "andi" ada di dalam "sandi".
    expect(ids(filterBy({ query: "andi router" }))).toEqual(["e1", "e2"]);
    // Satu kata yang tidak ada mematikan seluruh pencarian.
    expect(filterBy({ query: "router zzzz" })).toEqual([]);
    expect(filterBy({ query: "zzzz" })).toEqual([]);
    // Lebih sempit atau sama dengan tiap kata sendiri.
    const onlyAndi = new Set(ids(filterBy({ query: "prasetyo" })));
    const onlyRouter = new Set(ids(filterBy({ query: "router" })));
    for (const id of ids(filterBy({ query: "prasetyo router" }))) {
      expect(onlyAndi.has(id) && onlyRouter.has(id)).toBe(true);
    }
    expect(onlyAndi.size).toBeGreaterThan(1);
  });

  test("tidak peka huruf besar-kecil, dan spasi ganda, tab, serta spasi tak terputus tidak berpengaruh", () => {
    const base = ids(filterBy({ query: "prasetyo router" }));
    expect(base).toEqual(["e1"]);
    for (const query of [
      "PRASETYO ROUTER",
      "Prasetyo Router",
      "  prasetyo   router  ",
      "prasetyo\trouter",
      `prasetyo${NBSP}router`,
      `${NBSP}prasetyo \t\n router${NBSP}`,
    ]) {
      expect(ids(filterBy({ query })), JSON.stringify(query)).toEqual(base);
    }
  });

  test("huruf beraksen: bentuk utuh dan terurai saling menemukan", () => {
    // Satu catatan ditulis dengan huruf utuh, yang lain dengan aksen terurai.
    const eric = make("eric", T - 10, {
      target: `Pelanggan ${CAP_E_ACUTE}ric`,
    });
    const jose = make("jose", T - 20, { target: `Pelanggan Jose${ACUTE}` });
    const list = [eric, jose];
    for (const query of [
      `${E_ACUTE}ric`,
      `E${ACUTE}RIC`,
      `${CAP_E_ACUTE}ric`,
      `e${ACUTE}ric`,
    ]) {
      expect(ids(filterBy({ query }, list)), JSON.stringify(query)).toEqual([
        "eric",
      ]);
    }
    for (const query of [
      `jos${E_ACUTE}`,
      `JOSE${ACUTE}`,
      `JOS${CAP_E_ACUTE}`,
    ]) {
      expect(ids(filterBy({ query }, list)), JSON.stringify(query)).toEqual([
        "jose",
      ]);
    }
    // Tanpa aksen bukan huruf yang sama.
    expect(filterBy({ query: "eric" }, list)).toEqual([]);
    expect(filterBy({ query: "jose" }, list)).toEqual([]);
  });

  test("kueri yang hanya spasi tidak menyaring dan tidak dihitung aktif", () => {
    for (const query of ["", " ", "   ", "\t", "\n", NBSP, ` \t${NBSP}\n `]) {
      const filter = { ...emptyAuditFilter, query };
      expect(isFilterActive(filter), JSON.stringify(query)).toBe(false);
      expect(filterAudit(fixture, filter, T)).toBe(fixture);
      expect(matches(e1, filter, T)).toBe(true);
    }
  });

  test("tanda baca, tanda regex, kode HTML, dan emoji dibaca apa adanya, tanpa galat", () => {
    const odd = make("odd", T - 5, {
      target: "Objek (uji) [a-z]+ 50% 100%",
      summary: "Teks khusus: .* \\ <b>tebal</b> 😀 selesai.",
    });
    const list = [odd, e1];
    for (const query of [
      "(",
      ")",
      "[",
      "[a-z]+",
      ".*",
      "+",
      "?",
      "\\",
      "%",
      "50%",
      "<b>",
      "<script>alert(1)</script>",
      "😀",
      "a".repeat(5_000),
    ]) {
      const found = ids(filterBy({ query }, list));
      const needle = normalize(query);
      for (const id of found) {
        const entry = list.find((item) => item.id === id)!;
        expect(auditSearchableText(entry)).toContain(needle);
      }
    }
    expect(ids(filterBy({ query: "(uji)" }, list))).toEqual(["odd"]);
    expect(ids(filterBy({ query: ".*" }, list))).toEqual(["odd"]);
    expect(ids(filterBy({ query: "\\" }, list))).toEqual(["odd"]);
    expect(ids(filterBy({ query: "😀" }, list))).toEqual(["odd"]);
    expect(ids(filterBy({ query: "<b>tebal" }, list))).toEqual(["odd"]);
    // Titik bukan "huruf apa saja": "10x20" tidak sama dengan "10.20".
    expect(filterBy({ query: "10x20" }, list)).toEqual([]);
    expect(filterBy({ query: "<script>" }, list)).toEqual([]);
    expect(filterBy({ query: "a".repeat(5_000) }, list)).toEqual([]);
  });
});

test.describe("aksi dan petugas", () => {
  test("aksi harus sama persis, tiap aksi menyaring seperti penyaringan biasa", () => {
    for (const action of auditActionList) {
      expect(ids(filterBy({ action }))).toEqual(
        ids(fixture.filter((entry) => entry.action === action)),
      );
    }
    expect(ids(filterBy({ action: "router-updated" }))).toEqual(["e1", "e2"]);
    // Nilai yang bukan aksi sah tidak meloloskan apa pun.
    expect(filterBy({ action: "bukan-aksi" as AuditAction })).toEqual([]);
  });

  test("petugas dicocokkan lewat id, bukan nama, termasuk Sistem", () => {
    expect(ids(filterBy({ actor: "op-andi" }))).toEqual(["e1", "e3"]);
    expect(ids(filterBy({ actor: "op-siti" }))).toEqual(["e2"]);
    expect(ids(filterBy({ actor: "system" }))).toEqual(["e4"]);
    // Nama bukan id.
    expect(filterBy({ actor: "Andi Prasetyo" })).toEqual([]);
    expect(filterBy({ actor: "Sistem" })).toEqual([]);
    expect(filterBy({ actor: "op-hantu" })).toEqual([]);
  });

  test("semua saringan bersama adalah irisannya", () => {
    expect(
      ids(
        filterBy({
          query: "router",
          action: "router-updated",
          actor: "op-andi",
          within: "1h",
        }),
      ),
    ).toEqual(["e1"]);
    expect(
      filterBy({ query: "router", action: "router-updated", actor: "op-bayu" }),
    ).toEqual([]);
    expect(ids(filterBy({ actor: "op-andi", within: "1h" }))).toEqual([
      "e1",
      "e3",
    ]);
    expect(ids(filterBy({ actor: "op-andi", within: "24h" }))).toEqual([
      "e1",
      "e3",
    ]);
  });

  test("isFilterActive: tiap dimensi sendiri sudah membuatnya aktif", () => {
    expect(isFilterActive(emptyAuditFilter)).toBe(false);
    const changes: Partial<AuditFilter>[] = [
      { query: "a" },
      { action: "login" },
      { actor: "op-andi" },
      { within: "1h" },
      { within: "24h" },
      { within: "7d" },
    ];
    for (const change of changes) {
      expect(isFilterActive({ ...emptyAuditFilter, ...change })).toBe(true);
    }
    // emptyAuditFilter beku dan tidak bisa diubah diam-diam.
    expect(Object.isFrozen(emptyAuditFilter)).toBe(true);
    expect(emptyAuditFilter).toEqual({
      query: "",
      action: "all",
      actor: "all",
      within: "all",
    });
  });
});

test.describe("batas waktu", () => {
  const windows = [
    ["1h", 3_600],
    ["24h", 86_400],
    ["7d", 7 * 86_400],
  ] as const;

  test("durasinya 3600, 86400, dan 7 x 86400 detik", () => {
    expect(auditWithinSeconds).toEqual({
      "1h": 3_600,
      "24h": 86_400,
      "7d": 604_800,
    });
  });

  test("tegas sampai satu detik di batas: sedetik di dalam masuk, tepat di batas keluar, tepat sekarang masuk, sedetik ke depan keluar", () => {
    for (const [within, seconds] of windows) {
      const inside = make(`in-${within}`, T - seconds + 1);
      const edge = make(`edge-${within}`, T - seconds);
      const outside = make(`out-${within}`, T - seconds - 1);
      const present = make(`now-${within}`, T);
      const future = make(`future-${within}`, T + 1);
      const filter = { ...emptyAuditFilter, within };
      const verdict = (entry: AuditEntry) => matches(entry, filter, T);
      expect(verdict(inside), `${within} sedetik di dalam`).toBe(true);
      expect(verdict(edge), `${within} tepat di batas`).toBe(false);
      expect(verdict(outside), `${within} di luar`).toBe(false);
      expect(verdict(present), `${within} tepat sekarang`).toBe(true);
      expect(verdict(future), `${within} sedetik ke depan`).toBe(false);
      // filterAudit memakai aturan yang sama.
      expect(
        ids(filterAudit([future, present, inside, edge, outside], filter, T)),
      ).toEqual([`now-${within}`, `in-${within}`]);
    }
  });

  test("Waktu 'semua' tidak membatasi apa pun, termasuk catatan yang lama sekali", () => {
    const far = make("far", T - 40 * DAY);
    expect(matches(far, emptyAuditFilter, T)).toBe(true);
    expect(matches(make("later", T + 1), emptyAuditFilter, T)).toBe(true);
  });

  test("jendela ikut bergeser bersama nowSec", () => {
    const sample = make("slide", T - 3_000);
    const filter = { ...emptyAuditFilter, within: "1h" as const };
    expect(matches(sample, filter, T)).toBe(true);
    expect(matches(sample, filter, T + 599)).toBe(true);
    expect(matches(sample, filter, T + 600)).toBe(false);
    expect(matches(sample, filter, T - 3_001)).toBe(false);
    expect(matches(sample, filter, T - 3_000)).toBe(true);
  });

  test("angka di samping pilihan Waktu memakai batas yang sama", () => {
    for (const [within, seconds] of windows) {
      const list = [
        make("a", T + 1),
        make("b", T),
        make("c", T - seconds + 1),
        make("d", T - seconds),
        make("e", T - seconds - 1),
      ];
      const counts = auditFacetCounts(list, emptyAuditFilter, T);
      expect(counts.within[within], within).toBe(2);
      // Memilihnya menghasilkan persis sebanyak itu.
      expect(
        filterAudit(list, { ...emptyAuditFilter, within }, T),
      ).toHaveLength(2);
    }
    // Hanya batas 1 jam: dua catatan lolos dan ada di 24 jam serta 7 hari juga.
    const list = [
      make("p", T),
      make("q", T - 3_599),
      make("r", T - 3_600),
      make("s", T - 86_399),
      make("t", T - 86_400),
    ];
    const counts = auditFacetCounts(list, emptyAuditFilter, T);
    expect(counts.within).toEqual({ all: 5, "1h": 2, "24h": 4, "7d": 5 });
  });
});

test.describe("nilai yang bukan pilihan sah", () => {
  test("Waktu yang tidak dikenal tidak meloloskan apa pun, dihitung aktif, dan tidak membuat galat", () => {
    for (const within of ["30d", "toString", "__proto__", ""]) {
      const filter = { ...emptyAuditFilter, within: within as AuditWithin };
      expect(isFilterActive(filter), within).toBe(true);
      expect(filterAudit(fixture, filter, T), within).toEqual([]);
      expect(matches(e1, filter, T), within).toBe(false);
      const counts = auditFacetCounts(fixture, filter, T);
      expect(counts.total, within).toBe(0);
      // Dimensi sendiri diabaikan, jadi pilihan yang sah tetap berangka.
      expect(counts.within["1h"], within).toBe(3);
      expect(counts.action.all, within).toBe(0);
      // Kalimatnya menulis nilai itu apa adanya.
      expect(describeFilter(filter), within).toBe(within);
    }
  });

  test("aksi yang tidak dikenal: tidak ada yang lolos, dan teks barisnya tetap dibuat tanpa galat", () => {
    const filter = { ...emptyAuditFilter, action: "bukan-aksi" as AuditAction };
    expect(filterAudit(fixture, filter, T)).toEqual([]);
    expect(describeFilter(filter)).toBe('aksi "bukan-aksi"');
    // Catatan dengan aksi aneh (data luar yang salah) tetap bisa dicari.
    const odd = { ...e1, action: "bukan-aksi" } as unknown as AuditEntry;
    expect(auditSearchableText(odd)).toBe(
      "andi prasetyo router rtr-pusat-01 andi prasetyo mengubah alamat router rtr-pusat-01. alamat router: dari 10.0.0.1 ke 10.20.0.5",
    );
    expect(filterBy({ query: "alamat" }, [odd])).toEqual([odd]);
    expect(filterBy({ action: "router-updated" }, [odd])).toEqual([]);
    expect(auditFacetCounts([odd], emptyAuditFilter, T).total).toBe(1);
  });

  test("petugas berid 'all' (nilai cadangan) tidak dihitung dua kali", () => {
    const list = [
      make("a1", T - 1, { actor: { id: "all", name: "Semua Orang" } }),
      make("a2", T - 2),
      make("a3", T - 3),
    ];
    const counts = auditFacetCounts(list, emptyAuditFilter, T);
    expect(counts.actor.all).toBe(3);
    expect(counts.actor["op-andi"]).toBe(2);
    expect(counts.total).toBe(3);
  });
});

test.describe("hasil penyaringan", () => {
  test("tanpa saringan, array yang sama dikembalikan; juga saat saringan aktif tetapi tidak ada yang terbuang", () => {
    expect(filterAudit(fixture, emptyAuditFilter, T)).toBe(fixture);
    const entries = mockAuditLog(NOW);
    expect(filterAudit(entries, emptyAuditFilter, NOW)).toBe(entries);
    expect(filterAudit([], emptyAuditFilter, T)).toEqual([]);
    expect(filterBy({ action: "login" }, [])).toEqual([]);

    // Saringan aktif yang meloloskan semuanya: tetap array masukannya.
    const onlyLogins = [make("l1", T - 10), make("l2", T - 20)];
    expect(filterBy({ action: "login" }, onlyLogins)).toBe(onlyLogins);
    expect(filterBy({ actor: "op-andi" }, onlyLogins)).toBe(onlyLogins);
    expect(filterBy({ query: "andi" }, onlyLogins)).toBe(onlyLogins);
    expect(filterBy({ within: "1h" }, onlyLogins)).toBe(onlyLogins);
    expect(
      filterBy(
        { action: "login", actor: "op-andi", within: "7d", query: "ANDI" },
        onlyLogins,
      ),
    ).toBe(onlyLogins);
  });

  test("bila ada yang terbuang, hasilnya array baru dengan objek catatan yang sama dan urutan masukan", () => {
    const entries = mockAuditLog(NOW);
    const filters: Partial<AuditFilter>[] = [
      { action: "login" },
      { actor: "op-siti" },
      { query: "router" },
      { within: "24h" },
      { query: "kata sandi", actor: "op-andi" },
    ];
    for (const partial of filters) {
      const result = filterBy(partial, entries, NOW);
      expect(result, JSON.stringify(partial)).not.toBe(entries);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThan(entries.length);
      // Subbarisan dari masukan: objek yang sama, urutan yang sama.
      let cursor = 0;
      for (const entry of result) {
        const found = entries.indexOf(entry, cursor);
        expect(
          found,
          `${JSON.stringify(partial)} ${entry.id}`,
        ).toBeGreaterThanOrEqual(cursor);
        cursor = found + 1;
      }
    }
  });

  test("masukan tidak diubah", () => {
    const entries = Object.freeze(mockAuditLog(NOW).slice());
    const before = entries.map((entry) => entry.id);
    filterAudit(entries, { ...emptyAuditFilter, query: "router" }, NOW);
    auditFacetCounts(entries, { ...emptyAuditFilter, query: "router" }, NOW);
    actorOptions(entries);
    expect(entries.map((entry) => entry.id)).toEqual(before);
  });

  test("matches sama dengan keanggotaan di hasil filterAudit", () => {
    const entries = mockAuditLog(NOW);
    const filter: AuditFilter = {
      query: "router",
      action: "all",
      actor: "all",
      within: "7d",
    };
    const members = new Set(ids(filterAudit(entries, filter, NOW)));
    for (const entry of entries) {
      expect(matches(entry, filter, NOW), entry.id).toBe(members.has(entry.id));
    }
    expect(members.size).toBeGreaterThan(0);
  });
});

test.describe("pilihan petugas", () => {
  test("data tiruan: urut nama tanpa membedakan huruf, dan Sistem paling akhir", () => {
    const options = actorOptions(mockAuditLog(NOW));
    expect(options.map((actor) => actor.name)).toEqual([
      "Andi Prasetyo",
      "Bayu Kurniawan",
      "Ratna Wulandari",
      "Siti Nurhaliza",
      "Yoga Permadi",
      "Sistem",
    ]);
    expect(options.map((actor) => actor.id)).toEqual([
      "op-andi",
      "op-bayu",
      "op-ratna",
      "op-siti",
      "op-yoga",
      "system",
    ]);
  });

  test("Sistem tetap terakhir walau namanya lebih awal menurut abjad, dan tidak dikarang bila tak ada", () => {
    // "Sistem" mendahului "Siti Nurhaliza" menurut abjad: aturannya yang menaruhnya di akhir.
    expect("sistem" < "siti nurhaliza").toBe(true);
    const withSystem = actorOptions([e4, e2, e1]);
    expect(withSystem.map((actor) => actor.id)).toEqual([
      "op-andi",
      "op-siti",
      "system",
    ]);
    const withoutSystem = actorOptions([e2, e1]);
    expect(withoutSystem.map((actor) => actor.id)).toEqual([
      "op-andi",
      "op-siti",
    ]);
    expect(actorOptions([e4]).map((actor) => actor.name)).toEqual(["Sistem"]);
    expect(actorOptions([])).toEqual([]);
  });

  test("unik per id, nama dari catatan paling baru, berapa pun urutan masukan", () => {
    const lama = make("old", 100, { actor: { id: "op-x", name: "Nama Lama" } });
    const baru = make("new", 200, { actor: { id: "op-x", name: "Nama Baru" } });
    expect(actorOptions([baru, lama]).map((actor) => actor.name)).toEqual([
      "Nama Baru",
    ]);
    expect(actorOptions([lama, baru]).map((actor) => actor.name)).toEqual([
      "Nama Baru",
    ]);
    // Banyak catatan dari petugas yang sama hanya satu pilihan.
    expect(actorOptions([e1, e3, e1, e3])).toHaveLength(1);
  });

  test("urut nama tidak peka huruf besar-kecil, dan nama kembar diurutkan menurut id", () => {
    const actor = (id: string, name: string): AuditActor => ({ id, name });
    const list = [
      make("a", 1, { actor: actor("z-1", "zed") }),
      make("b", 2, { actor: actor("b-1", "bayu") }),
      make("c", 3, { actor: actor("a-1", "Andi") }),
      make("d", 4, { actor: actor("k-2", "Kembar") }),
      make("e", 5, { actor: actor("k-1", "kembar") }),
    ];
    expect(actorOptions(list).map((item) => item.id)).toEqual([
      "a-1",
      "b-1",
      "k-1",
      "k-2",
      "z-1",
    ]);
  });
});

test.describe("angka di samping pilihan", () => {
  test("dimensi sendiri diabaikan, dimensi lain tetap berlaku", () => {
    // Saringan aksi "login": pilihan aksi lain tetap punya angka sendiri.
    const filter: AuditFilter = { ...emptyAuditFilter, action: "login" };
    const counts = auditFacetCounts(fixture, filter, T);
    expect(counts.total).toBe(1);
    expect(counts.action.login).toBe(1);
    expect(counts.action["router-updated"]).toBe(2);
    expect(counts.action["billing-sync"]).toBe(1);
    expect(counts.action.logout).toBe(0);
    expect(counts.action.all).toBe(6);
    // Petugas dan waktu memakai saringan aksi itu.
    expect(counts.actor["op-andi"]).toBe(1);
    expect(counts.actor["op-siti"]).toBe(0);
    expect(counts.actor.all).toBe(1);
    expect(counts.within).toEqual({ all: 1, "1h": 1, "24h": 1, "7d": 1 });

    // Saringan petugas: angka pilihan petugas lain tidak ikut tersaring.
    const byActor = auditFacetCounts(
      fixture,
      { ...emptyAuditFilter, actor: "op-andi" },
      T,
    );
    expect(byActor.actor["op-siti"]).toBe(1);
    expect(byActor.actor["system"]).toBe(1);
    expect(byActor.actor.all).toBe(6);
    expect(byActor.action["router-updated"]).toBe(1);
    expect(byActor.total).toBe(2);

    // Saringan waktu: angka pilihan waktu lain tidak ikut tersaring.
    const byWithin = auditFacetCounts(
      fixture,
      { ...emptyAuditFilter, within: "1h" },
      T,
    );
    expect(byWithin.within).toEqual({ all: 6, "1h": 3, "24h": 5, "7d": 6 });
    expect(byWithin.action.all).toBe(3);
    expect(byWithin.total).toBe(3);

    // Kata kunci tetap berlaku di semua dimensi.
    const byQuery = auditFacetCounts(
      fixture,
      { ...emptyAuditFilter, query: "kata sandi" },
      T,
    );
    expect(byQuery.total).toBe(2);
    expect(byQuery.action["router-updated"]).toBe(1);
    expect(byQuery.action["cpe-changed"]).toBe(1);
    expect(byQuery.action.login).toBe(0);
    expect(byQuery.actor["op-siti"]).toBe(1);
    expect(byQuery.actor["op-andi"]).toBe(0);
    expect(byQuery.actor.all).toBe(2);
    expect(byQuery.within.all).toBe(2);
  });

  test("tanpa saringan, angkanya hitungan seluruh catatan, dan tiap dimensi menjumlah ke `all`-nya", () => {
    const entries = mockAuditLog(NOW);
    const counts = auditFacetCounts(entries, emptyAuditFilter, NOW);
    expect(counts.total).toBe(entries.length);
    expect(counts.action.all).toBe(entries.length);
    expect(counts.actor.all).toBe(entries.length);
    expect(counts.within.all).toBe(entries.length);
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    expect(sum(auditActionList.map((action) => counts.action[action]))).toBe(
      entries.length,
    );
    expect(
      sum(actorOptions(entries).map((actor) => counts.actor[actor.id])),
    ).toBe(entries.length);
    expect(counts.within["1h"]).toBeLessThanOrEqual(counts.within["24h"]);
    expect(counts.within["24h"]).toBeLessThanOrEqual(counts.within["7d"]);
    expect(counts.within["7d"]).toBeLessThanOrEqual(counts.within.all);
    // Kunci: sembilan aksi dan `all`; enam petugas dan `all`; empat waktu.
    expect(Object.keys(counts.action).sort()).toEqual(
      [...auditActionList, "all"].sort(),
    );
    expect(Object.keys(counts.actor).sort()).toEqual(
      [...actorOptions(entries).map((actor) => actor.id), "all"].sort(),
    );
    expect(Object.keys(counts.within).sort()).toEqual(
      ["1h", "24h", "7d", "all"].sort(),
    );
    // Semuanya bukan nol: datanya memang menyentuh tiap pilihan.
    for (const action of auditActionList) {
      expect(counts.action[action], action).toBeGreaterThan(0);
    }
  });

  test("daftar kosong: semua angka nol dan hanya `all` untuk petugas", () => {
    const counts = auditFacetCounts([], emptyAuditFilter, T);
    expect(counts.total).toBe(0);
    expect(Object.values(counts.action).every((value) => value === 0)).toBe(
      true,
    );
    expect(Object.keys(counts.actor)).toEqual(["all"]);
    expect(counts.actor.all).toBe(0);
    expect(counts.within).toEqual({ all: 0, "1h": 0, "24h": 0, "7d": 0 });
  });

  test("id petugas yang menyerupai properti objek hanyalah kunci biasa", () => {
    const proto = { id: "__proto__", name: "Proto" };
    const ctor = { id: "constructor", name: "Ctor" };
    const list = [
      make("p1", T - 1, { actor: proto }),
      make("p2", T - 2, { actor: proto }),
      make("c1", T - 3, { actor: ctor }),
      make("s1", T - 4, { actor: { id: "toString", name: "Str" } }),
    ];
    const counts = auditFacetCounts(list, emptyAuditFilter, T);
    expect(counts.actor["__proto__"]).toBe(2);
    expect(counts.actor["constructor"]).toBe(1);
    expect(counts.actor["toString"]).toBe(1);
    expect(counts.actor.all).toBe(4);
    expect(ids(filterBy({ actor: "__proto__" }, list))).toEqual(["p1", "p2"]);
    expect(ids(filterBy({ actor: "constructor" }, list))).toEqual(["c1"]);
    expect(actorOptions(list).map((actor) => actor.id)).toEqual([
      "constructor",
      "__proto__",
      "toString",
    ]);
  });
});

test.describe("kalimat saringan", () => {
  test("contoh dari kontrak, dan tanpa saringan", () => {
    expect(
      describeFilter({
        query: "router",
        action: "router-updated",
        actor: "op-andi",
        within: "24h",
      }),
    ).toBe(
      'kata "router", aksi "Router diubah", petugas "Andi Prasetyo", 24 jam terakhir',
    );
    expect(describeFilter(emptyAuditFilter)).toBe("tanpa saringan");
    expect(describeFilter({ ...emptyAuditFilter, query: ` \t${NBSP} ` })).toBe(
      "tanpa saringan",
    );
  });

  test("tiap dimensi sendiri, dalam urutan kata, aksi, petugas, waktu", () => {
    const only = (partial: Partial<AuditFilter>) =>
      describeFilter({ ...emptyAuditFilter, ...partial });
    expect(only({ query: "kata sandi" })).toBe('kata "kata sandi"');
    expect(only({ action: "billing-sync" })).toBe('aksi "Sinkron billing"');
    expect(only({ actor: "system" })).toBe('petugas "Sistem"');
    expect(only({ actor: "op-yoga" })).toBe('petugas "Yoga Permadi"');
    expect(only({ within: "1h" })).toBe("1 jam terakhir");
    expect(only({ within: "24h" })).toBe("24 jam terakhir");
    expect(only({ within: "7d" })).toBe("7 hari terakhir");
    expect(only({ action: "login", within: "7d" })).toBe(
      'aksi "Masuk", 7 hari terakhir',
    );
    for (const action of auditActionList) {
      expect(only({ action })).toContain('aksi "');
    }
  });

  test("kata kunci ditulis seperti diketik tetapi spasinya dirapikan, dan petugas tak dikenal ditulis idnya", () => {
    expect(
      describeFilter({ ...emptyAuditFilter, query: "  Router \t  ANDI  " }),
    ).toBe('kata "Router ANDI"');
    expect(describeFilter({ ...emptyAuditFilter, actor: "op-hantu" })).toBe(
      'petugas "op-hantu"',
    );
    // Daftar petugas dari data dipakai untuk menamai id.
    const actors: AuditActor[] = [{ id: "op-hantu", name: "Si Hantu" }];
    expect(
      describeFilter({ ...emptyAuditFilter, actor: "op-hantu" }, actors),
    ).toBe('petugas "Si Hantu"');
  });

  test("kata kunci panjang dipotong dengan tanda ellipsis dan emoji tidak terbelah", () => {
    const long = "a".repeat(AUDIT_QUERY_PREVIEW_MAX + 40);
    const text = describeFilter({ ...emptyAuditFilter, query: long });
    expect(text).toBe(`kata "${"a".repeat(AUDIT_QUERY_PREVIEW_MAX)}…"`);
    // Tepat di batas: tidak dipotong.
    const exact = "b".repeat(AUDIT_QUERY_PREVIEW_MAX);
    expect(describeFilter({ ...emptyAuditFilter, query: exact })).toBe(
      `kata "${exact}"`,
    );
    // Emoji tepat di batas: dipotong per titik kode, bukan di tengah pasangannya.
    const emoji = `${"a".repeat(AUDIT_QUERY_PREVIEW_MAX - 1)}😀bb`;
    const cut = describeFilter({ ...emptyAuditFilter, query: emoji });
    expect(cut).toBe(`kata "${"a".repeat(AUDIT_QUERY_PREVIEW_MAX - 1)}😀…"`);
    expect(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
        cut,
      ),
    ).toBe(false);
  });
});

// --- Uji acak terhadap pemeriksa referensi ----------------------------------

// Label dan kelompok ditulis lagi di sini (bukan diambil dari audit.ts), supaya
// perubahan yang tidak disengaja pada tabel aksi ketahuan.
const REF_ACTIONS: Record<string, [label: string, group: string]> = {
  login: ["Masuk", "Akses"],
  logout: ["Keluar", "Akses"],
  "alert-handled": ["Tandai ditangani", "Alert"],
  "threshold-changed": ["Ambang diubah", "Alert"],
  "router-added": ["Router ditambah", "Perangkat"],
  "router-updated": ["Router diubah", "Perangkat"],
  "cpe-changed": ["CPE pelanggan diubah", "Perangkat"],
  "billing-sync": ["Sinkron billing", "Pengaturan"],
  "settings-changed": ["Pengaturan diubah", "Pengaturan"],
};
const REF_WINDOWS: Record<string, number> = {
  "1h": 3_600,
  "24h": 86_400,
  "7d": 604_800,
};

// Teks baris menurut kontrak, disusun dengan cara paling lugas.
const refTextCache = new Map<string, string>();
function refText(entry: AuditEntry): string {
  const cached = refTextCache.get(entry.id);
  if (cached !== undefined) return cached;
  const [label, group] = REF_ACTIONS[entry.action];
  let text = "";
  text += `${entry.actor.name}\n${label}\n${group}\n${entry.target}\n${entry.summary}\n`;
  for (const change of entry.changes) {
    text += change.redacted
      ? `${change.field}: nilai disembunyikan\n`
      : `${change.field}: dari ${change.from} ke ${change.to}\n`;
  }
  const lowered = text.toLowerCase();
  refTextCache.set(entry.id, lowered);
  return lowered;
}

function refMatches(entry: AuditEntry, filter: AuditFilter, now: number) {
  for (const word of filter.query.toLowerCase().split(/\s+/)) {
    if (word !== "" && !refText(entry).includes(word)) return false;
  }
  if (filter.action !== "all" && entry.action !== filter.action) return false;
  if (filter.actor !== "all" && entry.actor.id !== filter.actor) return false;
  if (filter.within !== "all") {
    const seconds = REF_WINDOWS[filter.within];
    if (!(entry.at > now - seconds)) return false;
    if (!(entry.at <= now)) return false;
  }
  return true;
}

function refCount(
  entries: readonly AuditEntry[],
  filter: AuditFilter,
  now: number,
) {
  let count = 0;
  for (const entry of entries) {
    if (refMatches(entry, filter, now)) count += 1;
  }
  return count;
}

const QUERIES = [
  "",
  "",
  "router",
  "andi",
  "kata sandi",
  "ROUTER andi",
  "  siti  ",
  "sinkron",
  "10.20",
  "disembunyikan",
  "zzzz",
  "perangkat",
  "wi-fi",
  "ambang cpu",
  "tagihan",
  "nilai",
  "dari",
  "bunyi alert",
  "token",
  "yoga masuk",
];
const ACTIONS_ALL: (AuditAction | "all")[] = ["all", ...auditActionList];
const ACTORS_ALL = [
  "all",
  ...auditOperators.map((actor) => actor.id),
  AUDIT_SYSTEM_ACTOR.id,
  "op-hantu",
];
const WITHINS: AuditWithin[] = ["all", "1h", "24h", "7d"];

test.describe("uji acak terhadap pemeriksa referensi", () => {
  // Beberapa nowSec dengan data tiruan penuh, dan waktu saringan yang kadang
  // tertinggal dari data (supaya ada catatan di "masa depan" dan batas yang
  // jatuh di tengah hari).
  const nows = [
    NOW,
    NOW + 3 * DAY + 4_567,
    NOW + 29 * DAY + 61,
    NOW + 200 * DAY + 86_399,
  ];

  for (const [index, now] of nows.entries()) {
    test(`150 keadaan acak pada nowSec #${index + 1}: hasil dan setiap angka pilihan sama dengan referensi`, () => {
      const entries = mockAuditLog(now);
      expect(entries.length).toBeGreaterThan(100);
      const random = mulberry32(1_000 + index);
      const pick = <T>(values: readonly T[]) =>
        values[Math.floor(random() * values.length)];
      const bad = collector();
      let nonEmpty = 0;
      let narrowed = 0;
      for (let state = 0; state < 150; state += 1) {
        // Tiap dimensi kosong separuh waktu, supaya cukup banyak keadaan yang
        // berisi dan cukup banyak yang menyempit.
        const filter: AuditFilter = {
          query: random() < 0.4 ? "" : pick(QUERIES),
          action: random() < 0.5 ? "all" : pick(ACTIONS_ALL),
          actor: random() < 0.5 ? "all" : pick(ACTORS_ALL),
          within: pick(WITHINS),
        };
        // Waktu saringan: sama dengan data, atau tertinggal sampai 3 jam
        // (kadang rata di awal menit seperti useNowMinute).
        let at = now - Math.floor(random() * 3 * 3_600);
        if (random() < 0.5) at -= at % 60;
        const where = `#${state} ${JSON.stringify(filter)} @${at}`;

        const expected = entries.filter((entry) =>
          refMatches(entry, filter, at),
        );
        const actual = filterAudit(entries, filter, at);
        bad.check(
          JSON.stringify(ids(actual)) === JSON.stringify(ids(expected)),
          `${where}: hasil ${actual.length} != ${expected.length}`,
        );
        if (expected.length > 0) nonEmpty += 1;
        if (expected.length < entries.length) narrowed += 1;
        // Identitas: array masukan bila tidak ada yang terbuang.
        bad.check(
          (actual === entries) === (expected.length === entries.length),
          `${where}: identitas array`,
        );
        for (const entry of entries) {
          bad.check(
            matches(entry, filter, at) === refMatches(entry, filter, at),
            `${where}: matches ${entry.id}`,
          );
        }

        // Angka di samping tiap pilihan = hasil bila pilihan itu dipilih.
        const counts = auditFacetCounts(entries, filter, at);
        bad.check(counts.total === expected.length, `${where}: total`);
        for (const action of ACTIONS_ALL) {
          bad.check(
            counts.action[action] ===
              refCount(entries, { ...filter, action }, at),
            `${where}: aksi ${action}`,
          );
        }
        const options = actorOptions(entries).map((actor) => actor.id);
        for (const actor of ["all", ...options]) {
          bad.check(
            counts.actor[actor] === refCount(entries, { ...filter, actor }, at),
            `${where}: petugas ${actor}`,
          );
        }
        for (const within of WITHINS) {
          bad.check(
            counts.within[within] ===
              refCount(entries, { ...filter, within }, at),
            `${where}: waktu ${within}`,
          );
        }
        // Dan juga lewat filterAudit sendiri: memilih opsi memberi sebanyak angkanya.
        for (const action of ACTIONS_ALL) {
          bad.check(
            filterAudit(entries, { ...filter, action }, at).length ===
              counts.action[action],
            `${where}: filterAudit aksi ${action}`,
          );
        }
      }
      bad.done();
      // Ujiannya tidak kosong: ada keadaan berisi dan ada yang menyempit.
      expect(nonEmpty).toBeGreaterThan(40);
      expect(narrowed).toBeGreaterThan(40);
    });
  }

  test("pilihan petugas di data tiruan semuanya dikenal oleh referensi (enam id)", () => {
    const options = actorOptions(mockAuditLog(NOW)).map((actor) => actor.id);
    expect(options).toHaveLength(6);
    for (const id of options) expect(ACTORS_ALL).toContain(id);
  });
});
