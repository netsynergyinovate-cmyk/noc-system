import { expect, test } from "@playwright/test";
import {
  BILLING_HISTORY_RUNS,
  BILLING_SYNC_INTERVAL_SECONDS,
  billingMatchHints,
  billingMatchLabels,
  billingStatusLabels,
  describeSyncInterval,
  describeSyncResult,
  loadBilling,
  matchBilling,
  mockBillingOverview,
  mockBillingRecords,
  mockBillingSync,
  normalizePppoe,
  sortRuns,
  summarizeBilling,
  summarizeSync,
  unmatchedHints,
  unmatchedLabels,
  type BillingCustomer,
  type BillingMatch,
  type BillingRecord,
  type BillingRow,
  type BillingSyncRun,
  type UnmatchedReason,
} from "../src/lib/dashboard/billing";
import {
  billingFacetCounts,
  billingRouters,
  billingSearchText,
  billingSearchTerms,
  defaultBillingFilters,
  filterBillingRows,
  hasActiveBillingFilters,
  type BillingFilters,
} from "../src/lib/dashboard/billing-filter";
import { formatInteger } from "../src/lib/dashboard/format";
import { createMockFeed } from "../src/lib/dashboard/mock-feed";
import {
  createMockCustomers,
  mockRouters,
} from "../src/lib/dashboard/mock-data";
import { BILLING_START } from "./billing-moments";

// Status billing dengan data tiruan: aturan pencocokan tagihan dengan pelanggan
// lewat nama PPPoE, jadwal sinkron tiap jam, ringkasan, dan pencarian. Semuanya
// tanpa browser.

const NOW = BILLING_START;
const HOUR = 3_600;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Membandingkan dua daftar panjang tanpa memberi laporan galat yang besar:
// kembalinya teks tentang elemen pertama yang berbeda, atau null bila sama.
function firstDifference(a: readonly unknown[], b: readonly unknown[]) {
  if (a.length !== b.length) return `panjang ${a.length} != ${b.length}`;
  for (let i = 0; i < a.length; i += 1) {
    const left = JSON.stringify(a[i]);
    const right = JSON.stringify(b[i]);
    if (left !== right) return `elemen ${i}: ${left} != ${right}`;
  }
  return null;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

const routerName = (id: string) => `Router ${id}`;

function customer(
  n: number,
  extra: Partial<BillingCustomer> = {},
): BillingCustomer {
  return {
    id: `c${n}`,
    name: `Pelanggan ${n}`,
    pppoeUsername: `user${n}`,
    routerId: "r1",
    billingStatus: "lunas",
    ...extra,
  };
}

function record(
  invoiceRef: string,
  pppoeUsername: string,
  status: BillingRecord["status"] = "lunas",
): BillingRecord {
  return { invoiceRef, pppoeUsername, status };
}

function rowOf(rows: BillingRow[], customerId: string) {
  const row = rows.find((item) => item.customerId === customerId);
  if (!row) throw new Error(`tidak ada baris untuk ${customerId}`);
  return row;
}

test.describe("aturan pencocokan tagihan dengan pelanggan", () => {
  test("nama persis cocok, dan status serta kode tagihan diambil dari tagihan", () => {
    const { rows, unmatched } = matchBilling(
      [customer(1, { billingStatus: "lunas" })],
      [record("INV-1", "user1", "isolir")],
      routerName,
    );
    expect(unmatched).toEqual([]);
    expect(rows).toEqual([
      {
        customerId: "c1",
        name: "Pelanggan 1",
        pppoeUsername: "user1",
        routerId: "r1",
        routerName: "Router r1",
        status: "isolir",
        match: "exact",
        invoiceRef: "INV-1",
        billingName: "user1",
      },
    ]);
  });

  test("pelanggan tanpa tagihan tidak berubah: status tersimpan tetap, kode dan nama billing kosong", () => {
    const { rows, unmatched } = matchBilling(
      [
        customer(1, { billingStatus: "isolir" }),
        customer(2, { billingStatus: "lunas" }),
      ],
      [record("INV-2", "user2")],
      routerName,
    );
    expect(unmatched).toEqual([]);
    const none = rowOf(rows, "c1");
    expect(none.match).toBe("none");
    expect(none.status).toBe("isolir");
    expect(none.invoiceRef).toBeNull();
    expect(none.billingName).toBeNull();
    expect(rowOf(rows, "c2").match).toBe("exact");
  });

  test("huruf besar dan spasi di ujung dirapikan, dan nama di billing tetap ditulis apa adanya", () => {
    for (const written of [
      "USER1",
      "User1",
      " user1",
      "user1 ",
      "  User1  ",
      "\tuser1\n",
    ]) {
      const { rows, unmatched } = matchBilling(
        [customer(1)],
        [record("INV-1", written, "isolir")],
        routerName,
      );
      expect(unmatched, JSON.stringify(written)).toEqual([]);
      const row = rowOf(rows, "c1");
      expect(row.match, JSON.stringify(written)).toBe("normalized");
      expect(row.billingName).toBe(written);
      // Status dari tagihan, bukan dari yang tersimpan.
      expect(row.status).toBe("isolir");
      expect(row.invoiceRef).toBe("INV-1");
    }
  });

  test("selain huruf besar dan spasi di ujung, perbedaan tidak dimaafkan", () => {
    for (const written of [
      "us er1",
      "user 1",
      "user",
      "user11",
      "user-1",
      "",
    ]) {
      const { rows, unmatched } = matchBilling(
        [customer(1)],
        [record("INV-1", written)],
        routerName,
      );
      expect(rowOf(rows, "c1").match, JSON.stringify(written)).toBe("none");
      expect(unmatched, JSON.stringify(written)).toEqual([
        {
          invoiceRef: "INV-1",
          pppoeUsername: written,
          status: "lunas",
          reason: "unknown",
        },
      ]);
    }
  });

  test("tagihan untuk nama yang tidak ada dilaporkan, dan tidak mengubah pelanggan mana pun", () => {
    const customers = [customer(1), customer(2, { billingStatus: "isolir" })];
    const { rows, unmatched } = matchBilling(
      customers,
      [record("INV-9", "orang.asing", "isolir")],
      routerName,
    );
    expect(unmatched).toEqual([
      {
        invoiceRef: "INV-9",
        pppoeUsername: "orang.asing",
        status: "isolir",
        reason: "unknown",
      },
    ]);
    expect(rows.map((row) => [row.match, row.status])).toEqual([
      ["none", "lunas"],
      ["none", "isolir"],
    ]);
  });

  test("tagihan yang persis menang atas yang dirapikan, berapa pun urutannya", () => {
    const loose = record("INV-A", "USER1");
    const exact = record("INV-B", "user1", "isolir");
    for (const records of [
      [loose, exact],
      [exact, loose],
    ]) {
      const { rows, unmatched } = matchBilling(
        [customer(1)],
        records,
        routerName,
      );
      const row = rowOf(rows, "c1");
      expect(row.match).toBe("exact");
      expect(row.invoiceRef).toBe("INV-B");
      expect(row.status).toBe("isolir");
      expect(unmatched).toEqual([
        {
          invoiceRef: "INV-A",
          pppoeUsername: "USER1",
          status: "lunas",
          reason: "duplicate",
        },
      ]);
    }
  });

  test("dua tagihan yang sama-sama persis: yang pertama dipakai dan yang kedua ganda", () => {
    const first = record("INV-1", "user1");
    const second = record("INV-2", "user1", "isolir");
    const forward = matchBilling([customer(1)], [first, second], routerName);
    expect(rowOf(forward.rows, "c1").invoiceRef).toBe("INV-1");
    expect(
      forward.unmatched.map((item) => [item.invoiceRef, item.reason]),
    ).toEqual([["INV-2", "duplicate"]]);
    const reversed = matchBilling([customer(1)], [second, first], routerName);
    expect(rowOf(reversed.rows, "c1").invoiceRef).toBe("INV-2");
    expect(rowOf(reversed.rows, "c1").status).toBe("isolir");
    expect(
      reversed.unmatched.map((item) => [item.invoiceRef, item.reason]),
    ).toEqual([["INV-1", "duplicate"]]);
  });

  test("dua tagihan yang dirapikan ke pelanggan yang sama: yang pertama dipakai dan yang kedua ganda", () => {
    const { rows, unmatched } = matchBilling(
      [customer(1)],
      [record("INV-1", " user1"), record("INV-2", "USER1")],
      routerName,
    );
    const row = rowOf(rows, "c1");
    expect(row.match).toBe("normalized");
    expect(row.invoiceRef).toBe("INV-1");
    expect(unmatched.map((item) => [item.invoiceRef, item.reason])).toEqual([
      ["INV-2", "duplicate"],
    ]);
  });

  test("nama yang setelah dirapikan cocok dengan dua pelanggan tidak ditebak", () => {
    // Nama PPPoE MikroTik membedakan huruf besar dan kecil, jadi keduanya sah.
    const customers = [
      customer(1, { pppoeUsername: "Budi01" }),
      customer(2, { pppoeUsername: "budi01" }),
    ];
    for (const written of ["BUDI01", " budi01", "bUDI01"]) {
      const { rows, unmatched } = matchBilling(
        customers,
        [record("INV-1", written)],
        routerName,
      );
      expect(
        rows.map((row) => row.match),
        written,
      ).toEqual(["none", "none"]);
      expect(
        unmatched.map((item) => item.reason),
        written,
      ).toEqual(["ambiguous"]);
    }
    // Yang ditulis persis tetap dikenali, dan tidak menyentuh pelanggan satunya.
    const { rows, unmatched } = matchBilling(
      customers,
      [record("INV-2", "budi01"), record("INV-1", "Budi01")],
      routerName,
    );
    expect(unmatched).toEqual([]);
    expect(rowOf(rows, "c1").invoiceRef).toBe("INV-1");
    expect(rowOf(rows, "c2").invoiceRef).toBe("INV-2");
    expect(rows.every((row) => row.match === "exact")).toBe(true);
  });

  test("baris urut nama lalu username, dengan angka diurutkan menurut nilainya", () => {
    const customers = [
      customer(1, { name: "Citra", pppoeUsername: "citra1" }),
      customer(2, { name: "Ani", pppoeUsername: "ani2" }),
      customer(3, { name: "Ani", pppoeUsername: "ani1" }),
      customer(4, { name: "Budi", pppoeUsername: "budi" }),
      customer(5, { name: "Paket 10", pppoeUsername: "p10" }),
      customer(6, { name: "Paket 2", pppoeUsername: "p2" }),
    ];
    const { rows } = matchBilling(customers, [], routerName);
    expect(rows.map((row) => row.customerId)).toEqual([
      "c3",
      "c2",
      "c4",
      "c1",
      "c6",
      "c5",
    ]);
  });

  test("tagihan yang belum cocok urut kode tagihan, dengan angka diurutkan menurut nilainya", () => {
    const { unmatched } = matchBilling(
      [],
      [
        record("INV-10-B", "x"),
        record("INV-10", "y"),
        record("INV-9", "z"),
        record("INV-2", "z"),
      ],
      routerName,
    );
    expect(unmatched.map((item) => item.invoiceRef)).toEqual([
      "INV-2",
      "INV-9",
      "INV-10",
      "INV-10-B",
    ]);
  });

  test("tidak mengubah masukannya, dan nama router ditanyakan per pelanggan", () => {
    const customers = deepFreeze([
      customer(1, { routerId: "ra" }),
      customer(2, { routerId: "rb" }),
    ]);
    const records = deepFreeze([
      record("INV-1", "USER1"),
      record("INV-2", "x"),
    ]);
    const before = JSON.stringify([customers, records]);
    const asked: string[] = [];
    const { rows } = matchBilling(customers, records, (id) => {
      asked.push(id);
      return `nama ${id}`;
    });
    expect(JSON.stringify([customers, records])).toBe(before);
    expect(rows.map((row) => row.routerName)).toEqual(["nama ra", "nama rb"]);
    expect(asked.sort()).toEqual(["ra", "rb"]);
  });

  test("tanpa pelanggan dan tanpa tagihan hasilnya kosong", () => {
    expect(matchBilling([], [], routerName)).toEqual({
      rows: [],
      unmatched: [],
    });
  });

  test("normalizePppoe membuang spasi di ujung dan menjadikan huruf kecil", () => {
    expect(normalizePppoe("  Budi.Santoso001 ")).toBe("budi.santoso001");
    expect(normalizePppoe("a b")).toBe("a b");
    expect(normalizePppoe("")).toBe("");
  });
});

// Pembanding yang sengaja ditulis lain dan lambat: mencari dengan menyaring
// seluruh daftar tiap kali, tanpa peta.
function referenceMatch(
  customers: readonly BillingCustomer[],
  records: readonly BillingRecord[],
) {
  const norm = (text: string) => text.trim().toLowerCase();
  const claimed = new Map<string, { index: number; how: BillingMatch }>();
  const reasons = new Map<number, UnmatchedReason>();
  records.forEach((rec, index) => {
    const hit = customers.find((c) => c.pppoeUsername === rec.pppoeUsername);
    if (!hit) return;
    if (claimed.has(hit.id)) reasons.set(index, "duplicate");
    else claimed.set(hit.id, { index, how: "exact" });
  });
  records.forEach((rec, index) => {
    if (customers.some((c) => c.pppoeUsername === rec.pppoeUsername)) return;
    const hits = customers.filter(
      (c) => norm(c.pppoeUsername) === norm(rec.pppoeUsername),
    );
    if (hits.length === 0) reasons.set(index, "unknown");
    else if (hits.length > 1) reasons.set(index, "ambiguous");
    else if (claimed.has(hits[0].id)) reasons.set(index, "duplicate");
    else claimed.set(hits[0].id, { index, how: "normalized" });
  });
  return { claimed, reasons };
}

// Data acak yang sengaja penuh jebakan: pelanggan yang namanya hanya beda huruf
// besar, tagihan ganda, tagihan salah ketik, dan tagihan tanpa pelanggan.
function randomScenario(seed: number) {
  const random = mulberry32(seed);
  const customerCount = 4 + Math.floor(random() * 30);
  const names = new Set<string>();
  const customers: BillingCustomer[] = [];
  for (let i = 0; i < customerCount; i += 1) {
    let name = `user${Math.floor(random() * customerCount)}`;
    if (random() < 0.2) name = name.toUpperCase();
    if (names.has(name)) name = `${name}-${i}`;
    names.add(name);
    customers.push(
      customer(i, {
        pppoeUsername: name,
        name: `Nama ${Math.floor(random() * 6)}`,
        billingStatus: random() < 0.2 ? "isolir" : "lunas",
      }),
    );
  }
  const records: BillingRecord[] = [];
  const respell = (name: string) => {
    const pick = random();
    return pick < 0.25
      ? name.toUpperCase()
      : pick < 0.5
        ? ` ${name}`
        : pick < 0.75
          ? `${name} `
          : name.toLowerCase();
  };
  for (const c of customers) {
    const pick = random();
    if (pick < 0.15) continue;
    const written = pick < 0.5 ? c.pppoeUsername : respell(c.pppoeUsername);
    records.push(
      record(
        `INV-${records.length}`,
        written,
        random() < 0.3 ? "isolir" : "lunas",
      ),
    );
    if (random() < 0.1) {
      records.push(record(`INV-${records.length}`, respell(c.pppoeUsername)));
    }
  }
  for (let i = 0; i < 3; i += 1) {
    records.push(record(`INV-${records.length}`, `orang.asing${i}`));
  }
  // Urutan tagihan acak.
  for (let i = records.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [records[i], records[j]] = [records[j], records[i]];
  }
  return { customers, records };
}

test.describe("pencocokan pada data acak", () => {
  test("sama dengan pembanding yang ditulis lain, di 400 data acak", () => {
    const problems: string[] = [];
    for (let seed = 1; seed <= 400; seed += 1) {
      const { customers, records } = randomScenario(seed);
      const { rows, unmatched } = matchBilling(customers, records, routerName);
      const { claimed, reasons } = referenceMatch(customers, records);
      for (const c of customers) {
        const row = rowOf(rows, c.id);
        const claim = claimed.get(c.id);
        const expectedMatch = claim ? claim.how : "none";
        if (row.match !== expectedMatch) {
          problems.push(`${seed}/${c.id}: ${row.match} != ${expectedMatch}`);
          continue;
        }
        if (claim) {
          const rec = records[claim.index];
          if (
            row.invoiceRef !== rec.invoiceRef ||
            row.status !== rec.status ||
            row.billingName !== rec.pppoeUsername
          ) {
            problems.push(`${seed}/${c.id}: isi tagihan`);
          }
        } else if (
          row.status !== c.billingStatus ||
          row.invoiceRef !== null ||
          row.billingName !== null
        ) {
          problems.push(`${seed}/${c.id}: pelanggan tanpa tagihan berubah`);
        }
      }
      const expectedUnmatched = new Map(
        [...reasons].map(([index, reason]) => [
          records[index].invoiceRef,
          reason,
        ]),
      );
      if (unmatched.length !== expectedUnmatched.size) {
        problems.push(`${seed}: jumlah tagihan belum cocok`);
      }
      for (const item of unmatched) {
        if (expectedUnmatched.get(item.invoiceRef) !== item.reason) {
          problems.push(`${seed}/${item.invoiceRef}: alasan ${item.reason}`);
        }
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });

  test("tiap pelanggan satu baris, dan tiap tagihan tepat satu tempat: di baris atau di daftar belum cocok", () => {
    const problems: string[] = [];
    let ambiguous = 0;
    let duplicate = 0;
    let normalized = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const { customers, records } = randomScenario(seed);
      const { rows, unmatched } = matchBilling(customers, records, routerName);
      if (rows.length !== customers.length) problems.push(`${seed}: baris`);
      if (new Set(rows.map((row) => row.customerId)).size !== rows.length) {
        problems.push(`${seed}: baris ganda`);
      }
      const placed = [
        ...rows.flatMap((row) => (row.invoiceRef ? [row.invoiceRef] : [])),
        ...unmatched.map((item) => item.invoiceRef),
      ];
      if (placed.length !== records.length) problems.push(`${seed}: jumlah`);
      if (new Set(placed).size !== placed.length)
        problems.push(`${seed}: ganda`);
      const refs = new Set(records.map((rec) => rec.invoiceRef));
      if (placed.some((ref) => !refs.has(ref))) problems.push(`${seed}: asing`);
      ambiguous += unmatched.filter(
        (item) => item.reason === "ambiguous",
      ).length;
      duplicate += unmatched.filter(
        (item) => item.reason === "duplicate",
      ).length;
      normalized += rows.filter((row) => row.match === "normalized").length;
    }
    expect(problems.slice(0, 5)).toEqual([]);
    // Datanya memuat semua keadaan, jadi pengujian ini bermakna.
    expect(ambiguous).toBeGreaterThan(5);
    expect(duplicate).toBeGreaterThan(20);
    expect(normalized).toBeGreaterThan(100);
  });

  test("urutan tagihan tidak mengubah hasil bila tak ada dua tagihan yang berebut satu pelanggan", () => {
    const problems: string[] = [];
    let checked = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const { customers, records } = randomScenario(seed);
      const base = matchBilling(customers, records, routerName);
      if (base.unmatched.some((item) => item.reason === "duplicate")) {
        // Berebut: yang dipakai bergantung pada urutan, tetapi banyaknya tidak.
        const reversed = matchBilling(
          customers,
          [...records].reverse(),
          routerName,
        );
        const count = (rows: BillingRow[]) =>
          rows.filter((row) => row.match !== "none").length;
        if (count(reversed.rows) !== count(base.rows)) {
          problems.push(`${seed}: banyak yang cocok berubah`);
        }
        if (reversed.unmatched.length !== base.unmatched.length) {
          problems.push(`${seed}: banyak yang belum cocok berubah`);
        }
        continue;
      }
      checked += 1;
      const reversed = matchBilling(
        customers,
        [...records].reverse(),
        routerName,
      );
      if (JSON.stringify(reversed) !== JSON.stringify(base)) {
        problems.push(`${seed}: hasil berubah`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    expect(checked).toBeGreaterThan(30);
  });
});

test.describe("data billing tiruan", () => {
  const customers = createMockCustomers();
  const overview = mockBillingOverview(NOW);
  // Pelanggan seperti yang dikirim hub (dan tampil di tabel Pelanggan) pada NOW:
  // status tagihan mengikuti sinkron berhasil terakhir.
  const hub = createMockFeed(createMockCustomers()).snapshot(NOW).customers;

  test("sama setiap dihitung, dan di waktu lain yang berbeda hanya jadwal sinkron dan status yang diperbarui sinkron", () => {
    expect(JSON.stringify(mockBillingOverview(NOW))).toBe(
      JSON.stringify(overview),
    );
    const later = mockBillingOverview(NOW + 5 * HOUR + 123);
    // Selain status tagihan, baris sama persis; tagihan yang belum cocok tidak
    // berubah karena sinkron.
    const withoutStatus = (list: BillingRow[]) =>
      list.map(({ status, ...rest }) => {
        void status;
        return rest;
      });
    expect(
      firstDifference(withoutStatus(later.rows), withoutStatus(overview.rows)),
    ).toBeNull();
    expect(firstDifference(later.unmatched, overview.unmatched)).toBeNull();
    expect(JSON.stringify(later.sync)).not.toBe(JSON.stringify(overview.sync));
    // Dalam satu jam yang sama (tanpa sinkron selesai di antaranya) isinya sama,
    // dan daftarnya dipakai ulang.
    const first = mockBillingOverview(NOW + 60);
    const second = mockBillingOverview(NOW + 90);
    expect(second.rows).toBe(first.rows);
    expect(JSON.stringify(first.rows)).toBe(JSON.stringify(overview.rows));
  });

  test("loadBilling memberikan data yang sama dengan penghitungnya", async () => {
    const loaded = await loadBilling(NOW + 777);
    expect(JSON.stringify(loaded)).toBe(
      JSON.stringify(mockBillingOverview(NOW + 777)),
    );
  });

  test("satu baris untuk tiap pelanggan, dengan nama, username, dan router yang sama", () => {
    expect(overview.rows).toHaveLength(customers.length);
    const routerNames = new Map(mockRouters.map((r) => [r.id, r.name]));
    const byId = new Map(customers.map((c) => [c.id, c]));
    const problems: string[] = [];
    for (const row of overview.rows) {
      const c = byId.get(row.customerId);
      if (!c) {
        problems.push(`${row.customerId}: tak dikenal`);
        continue;
      }
      if (
        row.name !== c.name ||
        row.pppoeUsername !== c.pppoeUsername ||
        row.routerId !== c.routerId ||
        row.routerName !== routerNames.get(c.routerId)
      ) {
        problems.push(`${row.customerId}: isi`);
      }
    }
    expect(problems).toEqual([]);
    expect(new Set(overview.rows.map((row) => row.customerId)).size).toBe(
      customers.length,
    );
  });

  test("status di sini sama dengan status di tabel Pelanggan, untuk setiap pelanggan", () => {
    const byId = new Map(hub.map((c) => [c.id, c]));
    expect(byId.size).toBe(customers.length);
    const different = overview.rows.filter(
      (row) => row.status !== byId.get(row.customerId)!.billingStatus,
    );
    expect(different.map((row) => row.customerId)).toEqual([]);
  });

  test("memuat semua keadaan: persis, dirapikan, tanpa tagihan, dan tagihan ganda serta tak bertuan", () => {
    const matches = new Set(overview.rows.map((row) => row.match));
    expect([...matches].sort()).toEqual(["exact", "none", "normalized"]);
    const reasons = new Set(overview.unmatched.map((item) => item.reason));
    expect(reasons.has("unknown")).toBe(true);
    expect(reasons.has("duplicate")).toBe(true);
    // Yang bermasalah sedikit, seperti di ISP yang datanya cukup rapi.
    const share = (count: number) => count / overview.rows.length;
    const normalized = overview.rows.filter((r) => r.match === "normalized");
    const none = overview.rows.filter((r) => r.match === "none");
    expect(share(normalized.length)).toBeLessThan(0.2);
    expect(share(none.length)).toBeLessThan(0.15);
    expect(share(overview.unmatched.length)).toBeLessThan(0.2);
    expect(normalized.length).toBeGreaterThanOrEqual(2);
    expect(none.length).toBeGreaterThanOrEqual(2);
    // Pelanggan tanpa tagihan ada dua macam: yang tagihannya salah ketik di
    // billing (tagihan itu tampil di daftar belum cocok) dan yang sama sekali
    // tidak punya tagihan.
    const typed = new Set(
      overview.unmatched
        .filter((item) => item.reason === "unknown")
        .map((item) => item.pppoeUsername),
    );
    const withTypo = none.filter((row) =>
      typed.has(row.pppoeUsername.slice(0, -1)),
    );
    expect(withTypo.length).toBeGreaterThanOrEqual(1);
    expect(none.length - withTypo.length).toBeGreaterThanOrEqual(1);
  });

  test("isi tiap baris sesuai caranya cocok", () => {
    const problems: string[] = [];
    for (const row of overview.rows) {
      if (row.match === "exact") {
        if (row.billingName !== row.pppoeUsername)
          problems.push(row.customerId);
        if (!row.invoiceRef) problems.push(`${row.customerId}: kode`);
      } else if (row.match === "normalized") {
        if (
          !row.billingName ||
          row.billingName === row.pppoeUsername ||
          normalizePppoe(row.billingName) !== normalizePppoe(row.pppoeUsername)
        ) {
          problems.push(`${row.customerId}: nama billing`);
        }
        if (!row.invoiceRef) problems.push(`${row.customerId}: kode`);
      } else if (row.billingName !== null || row.invoiceRef !== null) {
        problems.push(`${row.customerId}: tanpa tagihan tetapi berisi`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("alasan tiap tagihan yang belum cocok benar menurut daftar pelanggan", () => {
    const exactNames = new Set(customers.map((c) => c.pppoeUsername));
    const normalizedNames = new Set(
      customers.map((c) => normalizePppoe(c.pppoeUsername)),
    );
    const claimedBy = new Map(
      overview.rows
        .filter((row) => row.billingName !== null)
        .map((row) => [normalizePppoe(row.billingName!), row.invoiceRef]),
    );
    const problems: string[] = [];
    for (const item of overview.unmatched) {
      const known = normalizedNames.has(normalizePppoe(item.pppoeUsername));
      if (item.reason === "unknown") {
        if (known || exactNames.has(item.pppoeUsername)) {
          problems.push(`${item.invoiceRef}: sebenarnya dikenal`);
        }
      } else if (item.reason === "duplicate") {
        // Pelanggannya ada dan sudah memakai tagihan lain.
        const used = claimedBy.get(normalizePppoe(item.pppoeUsername));
        if (!known || !used || used === item.invoiceRef) {
          problems.push(`${item.invoiceRef}: bukan ganda`);
        }
      } else {
        problems.push(`${item.invoiceRef}: alasan tak terduga ${item.reason}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("kode tagihan tidak pernah kembar, dan jumlah tagihan sama dengan yang dibaca dari billing", () => {
    const records = mockBillingRecords(customers);
    const refs = records.map((rec) => rec.invoiceRef);
    expect(new Set(refs).size).toBe(refs.length);
    const placed = [
      ...overview.rows.flatMap((row) =>
        row.invoiceRef ? [row.invoiceRef] : [],
      ),
      ...overview.unmatched.map((item) => item.invoiceRef),
    ];
    expect(placed.sort()).toEqual([...refs].sort());
  });

  test("baris urut nama lalu username dan tagihan belum cocok urut kode", () => {
    const compare = (a: string, b: string) =>
      a.localeCompare(b, "id", { numeric: true });
    const problems: string[] = [];
    overview.rows.forEach((row, index) => {
      const previous = overview.rows[index - 1];
      if (!previous) return;
      const order =
        compare(previous.name, row.name) ||
        compare(previous.pppoeUsername, row.pppoeUsername);
      if (order > 0) problems.push(`baris ${index}`);
    });
    overview.unmatched.forEach((item, index) => {
      const previous = overview.unmatched[index - 1];
      if (previous && compare(previous.invoiceRef, item.invoiceRef) > 0) {
        problems.push(`belum cocok ${index}`);
      }
    });
    expect(problems).toEqual([]);
  });

  test("ringkasan: lunas dan isolir menjumlah ke seluruh pelanggan, dan hitungan lain cocok dengan daftarnya", () => {
    const totals = summarizeBilling(overview.rows, overview.unmatched);
    expect(totals.customers).toBe(customers.length);
    expect(totals.lunas + totals.isolir).toBe(totals.customers);
    expect(totals.lunas).toBe(
      hub.filter((c) => c.billingStatus === "lunas").length,
    );
    expect(totals.isolir).toBe(
      hub.filter((c) => c.billingStatus === "isolir").length,
    );
    expect(totals.withoutInvoice).toBe(
      overview.rows.filter((row) => row.match === "none").length,
    );
    expect(totals.unmatchedInvoices).toBe(overview.unmatched.length);
    expect(summarizeBilling([], [])).toEqual({
      customers: 0,
      lunas: 0,
      isolir: 0,
      withoutInvoice: 0,
      unmatchedInvoices: 0,
    });
  });

  test("hasil tiap sinkron berhasil sama dengan hasil pencocokan, dan jumlahnya saling cocok", () => {
    const totals = summarizeBilling(overview.rows, overview.unmatched);
    let successes = 0;
    for (let t = NOW; t < NOW + 3 * 86_400; t += 1_800) {
      for (const run of mockBillingSync(t).runs) {
        if (run.status !== "success") continue;
        successes += 1;
        const result = run.result!;
        expect(result.invoices).toBe(result.matched + result.unmatched);
        expect(result.matched + result.withoutInvoice).toBe(totals.customers);
        expect(result.unmatched).toBe(totals.unmatchedInvoices);
        expect(result.withoutInvoice).toBe(totals.withoutInvoice);
        expect(result.invoices).toBe(mockBillingRecords(customers).length);
      }
    }
    expect(successes).toBeGreaterThan(100);
  });
});

// Pembantu jadwal yang ditulis lain: menelusuri slot satu per satu.
const OFFSET = mockBillingSync(NOW).runs[0].startedAt % HOUR;
const startOfSlot = (slot: number) => slot * HOUR + OFFSET;
function lastStartAtOrBefore(t: number) {
  let slot = Math.floor(t / HOUR) + 1;
  while (startOfSlot(slot) > t) slot -= 1;
  return startOfSlot(slot);
}
function nextStartAfter(t: number) {
  let slot = Math.floor(t / HOUR) - 1;
  while (startOfSlot(slot) <= t) slot += 1;
  return startOfSlot(slot);
}
// Kapan sinkron yang mulai pada `start` selesai, dibaca dari riwayat yang dibuat
// jauh sesudahnya.
function finishOf(start: number) {
  const run = mockBillingSync(start + 100).runs[0];
  expect(run.startedAt).toBe(start);
  return run.finishedAt;
}

test.describe("jadwal sinkron tiap jam", () => {
  test("mulai menit ke-5 tiap jam, dan jedanya tepat satu jam", () => {
    expect(BILLING_SYNC_INTERVAL_SECONDS).toBe(HOUR);
    expect(OFFSET).toBe(300);
    expect(mockBillingSync(NOW).intervalSeconds).toBe(HOUR);
    expect(BILLING_HISTORY_RUNS).toBe(24);
  });

  test("di setiap momen: berikutnya di depan, riwayat 24 sinkron berjarak satu jam, dan yang berjalan hanya yang belum selesai", () => {
    const problems: string[] = [];
    const finished = new Map<number, number>();
    let runningSeen = 0;
    const times: number[] = [];
    for (let t = NOW; t < NOW + 3 * 86_400; t += 97) times.push(t);
    // Tepat di batas tiap sinkron: sebelum mulai, mulai, sebelum selesai, selesai.
    for (let slot = 0; slot < 72; slot += 1) {
      const start = lastStartAtOrBefore(NOW) + slot * HOUR;
      const fin = finishOf(start);
      times.push(start - 1, start, start + 1, fin - 1, fin, fin + 1);
    }
    for (const t of times) {
      const sync = mockBillingSync(t);
      const lastStart = lastStartAtOrBefore(t);
      if (!finished.has(lastStart))
        finished.set(lastStart, finishOf(lastStart));
      const running = t < finished.get(lastStart)!;
      const label = `t=${t}`;
      if (sync.intervalSeconds !== HOUR) problems.push(`${label}: selang`);
      if (sync.nextRunAt !== nextStartAfter(t))
        problems.push(`${label}: berikutnya`);
      if (sync.nextRunAt <= t || sync.nextRunAt - t > HOUR) {
        problems.push(`${label}: berikutnya di luar satu jam ke depan`);
      }
      if (sync.runs.length !== BILLING_HISTORY_RUNS)
        problems.push(`${label}: panjang`);
      if (running) {
        runningSeen += 1;
        if (sync.running?.startedAt !== lastStart)
          problems.push(`${label}: berjalan`);
      } else if (sync.running !== null) {
        problems.push(`${label}: berjalan padahal sudah selesai`);
      }
      const newest = running ? lastStart - HOUR : lastStart;
      sync.runs.forEach((item, index) => {
        if (item.startedAt !== newest - index * HOUR)
          problems.push(`${label}: jarak ${index}`);
        const lasted = item.finishedAt - item.startedAt;
        if (lasted < 4 || lasted > 29) problems.push(`${label}: lama ${index}`);
        if (item.finishedAt > t)
          problems.push(`${label}: selesai di depan ${index}`);
        if (item.id !== `billing-sync-${(item.startedAt - OFFSET) / HOUR}`) {
          problems.push(`${label}: id ${index}`);
        }
      });
    }
    expect(problems.slice(0, 5)).toEqual([]);
    expect(runningSeen).toBeGreaterThan(50);
  });

  test("batas tegas: sinkron berjalan sejak detik mulainya sampai sebelum detik selesainya", () => {
    const start = lastStartAtOrBefore(NOW + 10 * HOUR);
    const fin = finishOf(start);
    const before = mockBillingSync(start - 1);
    expect(before.running).toBeNull();
    expect(before.nextRunAt).toBe(start);
    expect(before.runs[0].startedAt).toBe(start - HOUR);

    const at = mockBillingSync(start);
    expect(at.running).toEqual({ startedAt: start });
    expect(at.nextRunAt).toBe(start + HOUR);
    expect(at.runs[0].startedAt).toBe(start - HOUR);

    expect(mockBillingSync(fin - 1).running).toEqual({ startedAt: start });
    const done = mockBillingSync(fin);
    expect(done.running).toBeNull();
    expect(done.runs[0].startedAt).toBe(start);
    expect(done.runs[0].finishedAt).toBe(fin);
    expect(done.nextRunAt).toBe(start + HOUR);
  });

  test("isi sebuah sinkron tidak berubah ketika waktu bergeser, hanya letaknya di riwayat", () => {
    const seen = new Map<string, string>();
    const problems: string[] = [];
    for (let t = NOW; t < NOW + 2 * 86_400; t += 211) {
      for (const run of mockBillingSync(t).runs) {
        const text = JSON.stringify(run);
        const first = seen.get(run.id);
        if (first === undefined) seen.set(run.id, text);
        else if (first !== text) problems.push(run.id);
      }
    }
    expect(problems).toEqual([]);
    expect(seen.size).toBeGreaterThan(48);
  });

  test("sinkron berhasil memuat hasil dan tanpa pesan, yang gagal memuat pesan dan tanpa hasil", () => {
    let success = 0;
    let failed = 0;
    for (const run of mockBillingSync(NOW + 20 * HOUR).runs) {
      if (run.status === "success") {
        success += 1;
        expect(run.result).not.toBeNull();
        expect(run.error).toBeNull();
      } else {
        failed += 1;
        expect(run.result).toBeNull();
        expect(run.error).toMatch(/\.$/);
        expect(run.error!.length).toBeGreaterThan(20);
      }
    }
    expect(success + failed).toBe(24);
  });

  test("dalam 30 hari sebagian kecil sinkron gagal, dengan beberapa alasan berbeda, dan kadang beruntun", () => {
    const runs = new Map<string, BillingSyncRun>();
    for (let t = NOW; t < NOW + 30 * 86_400; t += HOUR) {
      for (const run of mockBillingSync(t).runs) runs.set(run.id, run);
    }
    const all = [...runs.values()];
    expect(all.length).toBeGreaterThan(700);
    const failed = all.filter((run) => run.status === "failed");
    const share = failed.length / all.length;
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.25);
    expect(new Set(failed.map((run) => run.error)).size).toBeGreaterThanOrEqual(
      3,
    );
    const ordered = sortRuns(all);
    let longest = 0;
    let streak = 0;
    for (const run of [...ordered].reverse()) {
      streak = run.status === "failed" ? streak + 1 : 0;
      longest = Math.max(longest, streak);
    }
    expect(longest).toBeGreaterThanOrEqual(2);
  });
});

function makeRun(
  id: string,
  finishedAt: number,
  status: BillingSyncRun["status"],
): BillingSyncRun {
  return {
    id,
    startedAt: finishedAt - 10,
    finishedAt,
    status,
    result:
      status === "success"
        ? { invoices: 3, matched: 2, unmatched: 1, withoutInvoice: 0 }
        : null,
    error: status === "failed" ? "gagal." : null,
  };
}

test.describe("ringkasan sinkron", () => {
  test("tanpa sinkron: tidak ada yang terakhir, tidak ada yang berhasil, tidak ada kegagalan", () => {
    expect(summarizeSync([])).toEqual({
      last: null,
      lastSuccess: null,
      consecutiveFailures: 0,
    });
  });

  test("kegagalan berturut-turut dihitung dari yang terbaru sampai yang berhasil", () => {
    const s = (id: string, at: number) => makeRun(id, at, "success");
    const f = (id: string, at: number) => makeRun(id, at, "failed");
    const cases: [string, BillingSyncRun[], number][] = [
      ["berhasil terbaru", [s("a", 400), f("b", 300), f("c", 200)], 0],
      ["satu gagal", [f("a", 400), s("b", 300), f("c", 200)], 1],
      ["dua gagal", [f("a", 400), f("b", 300), s("c", 200)], 2],
      [
        "tiga gagal, yang berhasil jauh",
        [f("a", 400), f("b", 300), f("c", 200), s("d", 100)],
        3,
      ],
    ];
    for (const [name, runs, failures] of cases) {
      const summary = summarizeSync(runs);
      expect(summary.consecutiveFailures, name).toBe(failures);
      expect(summary.last?.id, name).toBe("a");
      expect(summary.lastSuccess?.status, name).toBe("success");
      expect(summary.lastSuccess?.id, name).toBe(
        runs.find((item) => item.status === "success")!.id,
      );
    }
  });

  test("tidak pernah berhasil: semua sinkron dihitung gagal dan tidak ada data yang berhasil", () => {
    const summary = summarizeSync([
      makeRun("a", 300, "failed"),
      makeRun("b", 200, "failed"),
    ]);
    expect(summary.consecutiveFailures).toBe(2);
    expect(summary.last?.id).toBe("a");
    expect(summary.lastSuccess).toBeNull();
  });

  test("urutan masukan tidak memengaruhi, dan masukan tidak diubah", () => {
    const runs = deepFreeze([
      makeRun("lama-berhasil", 100, "success"),
      makeRun("baru-gagal", 300, "failed"),
      makeRun("tengah-gagal", 200, "failed"),
    ]);
    const forward = summarizeSync(runs);
    const reversed = summarizeSync([...runs].reverse());
    expect(forward.consecutiveFailures).toBe(2);
    expect(forward.last?.id).toBe("baru-gagal");
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
    expect(runs.map((item) => item.id)).toEqual([
      "lama-berhasil",
      "baru-gagal",
      "tengah-gagal",
    ]);
  });

  test("sortRuns: yang paling akhir selesai di atas, dan yang kembar diurut id menurun", () => {
    const sorted = sortRuns([
      makeRun("a", 100, "success"),
      makeRun("b", 300, "success"),
      makeRun("c", 300, "failed"),
      makeRun("d", 200, "success"),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["c", "b", "d", "a"]);
  });

  test("di data tiruan, angkanya sama dengan menghitung sendiri dari atas", () => {
    for (let t = NOW; t < NOW + 3 * 86_400; t += 600) {
      const { runs } = mockBillingSync(t);
      let expected = 0;
      while (expected < runs.length && runs[expected].status === "failed") {
        expected += 1;
      }
      const summary = summarizeSync(runs);
      expect(summary.consecutiveFailures, String(t)).toBe(expected);
      expect(summary.last?.id, String(t)).toBe(runs[0].id);
      expect(summary.lastSuccess?.id, String(t)).toBe(runs[expected]?.id);
    }
  });
});

test.describe("tulisan", () => {
  test("selang sinkron ditulis dengan kata yang wajar", () => {
    expect(describeSyncInterval(3_600)).toBe("tiap jam");
    expect(describeSyncInterval(7_200)).toBe("tiap 2 jam");
    expect(describeSyncInterval(1_800)).toBe("tiap 30 menit");
    expect(describeSyncInterval(60)).toBe("tiap 1 menit");
    expect(describeSyncInterval(90)).toBe("tiap 90 detik");
  });

  test("hasil sinkron memakai pemisah ribuan Indonesia", () => {
    expect(
      describeSyncResult({
        invoices: 104,
        matched: 94,
        unmatched: 10,
        withoutInvoice: 6,
      }),
    ).toBe("104 tagihan terbaca, 94 cocok, 10 belum cocok");
    expect(
      describeSyncResult({
        invoices: 2_345,
        matched: 2_300,
        unmatched: 45,
        withoutInvoice: 0,
      }),
    ).toBe("2.345 tagihan terbaca, 2.300 cocok, 45 belum cocok");
  });

  test("setiap keadaan punya nama dan penjelasan yang tidak kosong dan tidak kembar", () => {
    const matches: BillingMatch[] = ["exact", "normalized", "none"];
    const reasons: UnmatchedReason[] = ["unknown", "duplicate", "ambiguous"];
    const texts = [
      ...matches.flatMap((m) => [billingMatchLabels[m], billingMatchHints[m]]),
      ...reasons.flatMap((r) => [unmatchedLabels[r], unmatchedHints[r]]),
      billingStatusLabels.lunas,
      billingStatusLabels.isolir,
    ];
    expect(texts.every((text) => text.trim().length > 3)).toBe(true);
    expect(new Set(texts).size).toBe(texts.length);
    expect(billingStatusLabels).toEqual({ lunas: "Lunas", isolir: "Isolir" });
  });
});

// --- Pencarian dan saringan ------------------------------------------------

const rows = mockBillingOverview(NOW).rows;
const routers = billingRouters(rows);

function referenceText(row: BillingRow) {
  return [
    row.name,
    row.pppoeUsername,
    row.routerName,
    row.status === "lunas" ? "Lunas" : "Isolir",
    row.invoiceRef ?? "",
    {
      exact: "Cocok",
      normalized: "Cocok setelah dirapikan",
      none: "Belum ada tagihan",
    }[row.match],
  ]
    .join(" ")
    .toLowerCase();
}

function referenceFilter(all: BillingRow[], filters: BillingFilters) {
  const words = filters.query.toLowerCase().split(/\s+/).filter(Boolean);
  return all.filter(
    (row) =>
      (filters.status === "all" || row.status === filters.status) &&
      (filters.match === "all" || row.match === filters.match) &&
      (filters.routerId === "all" || row.routerId === filters.routerId) &&
      words.every((word) => referenceText(row).includes(word)),
  );
}

const ids = (list: BillingRow[]) => list.map((row) => row.customerId);

test.describe("pencarian dan saringan status billing", () => {
  test("tanpa saringan semua baris tampil, urutannya tetap, dan saringan dianggap tidak aktif", () => {
    expect(hasActiveBillingFilters(defaultBillingFilters)).toBe(false);
    expect(
      hasActiveBillingFilters({ ...defaultBillingFilters, query: "   " }),
    ).toBe(false);
    expect(ids(filterBillingRows(rows, defaultBillingFilters))).toEqual(
      ids(rows),
    );
    for (const filters of [
      { ...defaultBillingFilters, query: "a" },
      { ...defaultBillingFilters, status: "isolir" as const },
      { ...defaultBillingFilters, match: "none" as const },
      { ...defaultBillingFilters, routerId: routers[0].id },
    ]) {
      expect(hasActiveBillingFilters(filters)).toBe(true);
    }
  });

  test("kata kunci: tanpa membedakan huruf, semua kata harus ada, urutan kata bebas", () => {
    const target = rows.find((row) => row.name.includes(" "))!;
    const [first, second] = target.name.toLowerCase().split(" ");
    const find = (query: string) =>
      filterBillingRows(rows, { ...defaultBillingFilters, query });
    expect(ids(find(target.name.toUpperCase()))).toContain(target.customerId);
    expect(ids(find(`${second} ${first}`))).toContain(target.customerId);
    expect(ids(find(`  ${first}   ${second}  `))).toContain(target.customerId);
    expect(find("zzzz-tidak-ada")).toEqual([]);
    expect(find(`${first} zzzz-tidak-ada`)).toEqual([]);
    // Semua kata harus ada, jadi menambah kata tidak pernah menambah hasil.
    expect(find(`${first} ${second}`).length).toBeLessThanOrEqual(
      find(first).length,
    );
  });

  test("yang dicari adalah yang tampil: nama, username, router, kode tagihan, status, dan pencocokan", () => {
    const find = (query: string) =>
      ids(filterBillingRows(rows, { ...defaultBillingFilters, query }));
    const normalized = rows.find((row) => row.match === "normalized")!;
    const exact = rows.find((row) => row.match === "exact")!;
    const none = rows.find((row) => row.match === "none")!;
    expect(find(normalized.name)).toContain(normalized.customerId);
    expect(find(normalized.pppoeUsername)).toContain(normalized.customerId);
    expect(find(normalized.routerName)).toContain(normalized.customerId);
    expect(find(exact.invoiceRef!)).toContain(exact.customerId);
    expect(find(exact.invoiceRef!.toLowerCase())).toEqual([exact.customerId]);
    // Nama seperti tertulis di billing (huruf besar atau spasi di ujung) juga
    // menemukan barisnya, lewat username yang sama setelah dirapikan.
    expect(find(normalized.billingName!)).toContain(normalized.customerId);
    expect(find(normalized.billingName!.toUpperCase())).toContain(
      normalized.customerId,
    );
    expect(find("isolir")).toEqual(
      ids(rows.filter((row) => row.status === "isolir")),
    );
    expect(find("setelah dirapikan")).toEqual(
      ids(rows.filter((row) => row.match === "normalized")),
    );
    expect(find("belum ada tagihan")).toEqual(
      ids(rows.filter((row) => row.match === "none")),
    );
    expect(find(none.pppoeUsername)).toContain(none.customerId);
  });

  test("status, pencocokan, dan router menyaring, dan semuanya bersama menjadi irisan", () => {
    const run = (filters: Partial<BillingFilters>) =>
      ids(filterBillingRows(rows, { ...defaultBillingFilters, ...filters }));
    expect(run({ status: "lunas" })).toEqual(
      ids(rows.filter((row) => row.status === "lunas")),
    );
    expect(run({ status: "isolir" })).toEqual(
      ids(rows.filter((row) => row.status === "isolir")),
    );
    expect(run({ match: "none" })).toEqual(
      ids(rows.filter((row) => row.match === "none")),
    );
    expect(run({ routerId: routers[1].id })).toEqual(
      ids(rows.filter((row) => row.routerId === routers[1].id)),
    );
    expect(
      run({ status: "isolir", match: "exact", routerId: routers[0].id }),
    ).toEqual(
      ids(
        rows.filter(
          (row) =>
            row.status === "isolir" &&
            row.match === "exact" &&
            row.routerId === routers[0].id,
        ),
      ),
    );
    expect(run({ routerId: "tidak-ada" })).toEqual([]);
  });

  test("sama dengan penyaring yang ditulis lain, di 400 keadaan saringan acak", () => {
    const random = mulberry32(99);
    const queries = [
      "",
      " ",
      "a",
      "agus",
      "budi sa",
      "santoso budi",
      "INV-100",
      "inv-10014",
      "rtr-barat",
      "cocok",
      "setelah dirapikan",
      "isolir",
      "lunas",
      "tidak ada hasil",
      "  utami   ",
      "0",
    ];
    const pick = <T>(items: readonly T[]) =>
      items[Math.floor(random() * items.length)];
    const problems: string[] = [];
    for (let i = 0; i < 400; i += 1) {
      const filters: BillingFilters = {
        query: pick(queries),
        status: pick(["all", "lunas", "isolir"] as const),
        match: pick(["all", "exact", "normalized", "none"] as const),
        routerId: pick(["all", ...routers.map((router) => router.id)]),
      };
      const got = ids(filterBillingRows(rows, filters));
      const want = ids(referenceFilter(rows, filters));
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        problems.push(JSON.stringify(filters));
      }
    }
    expect(problems.slice(0, 3)).toEqual([]);
  });

  test("angka di samping tiap pilihan sama dengan hasil memilihnya, di 300 keadaan acak", () => {
    const random = mulberry32(7);
    const queries = ["", "a", "agus", "isolir", "cocok", "rtr", "xyz", "0"];
    const pick = <T>(items: readonly T[]) =>
      items[Math.floor(random() * items.length)];
    const problems: string[] = [];
    for (let i = 0; i < 300; i += 1) {
      const filters: BillingFilters = {
        query: pick(queries),
        status: pick(["all", "lunas", "isolir"] as const),
        match: pick(["all", "exact", "normalized", "none"] as const),
        routerId: pick(["all", ...routers.map((router) => router.id)]),
      };
      const counts = billingFacetCounts(rows, filters);
      const count = (change: Partial<BillingFilters>) =>
        filterBillingRows(rows, { ...filters, ...change }).length;
      if (counts.total !== count({})) problems.push(`${i}: total`);
      for (const status of ["lunas", "isolir"] as const) {
        if (counts.status[status] !== count({ status })) {
          problems.push(`${i}: status ${status}`);
        }
      }
      for (const match of ["exact", "normalized", "none"] as const) {
        if (counts.match[match] !== count({ match })) {
          problems.push(`${i}: match ${match}`);
        }
      }
      for (const router of routers) {
        if (counts.router[router.id] !== count({ routerId: router.id })) {
          problems.push(`${i}: router ${router.id}`);
        }
      }
      // "Semua" sama dengan jumlah pilihannya, karena tiap baris punya tepat satu.
      const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
      const all = (change: Partial<BillingFilters>) => count(change);
      if (sum(Object.values(counts.status)) !== all({ status: "all" })) {
        problems.push(`${i}: jumlah status`);
      }
      if (sum(Object.values(counts.match)) !== all({ match: "all" })) {
        problems.push(`${i}: jumlah match`);
      }
      if (sum(Object.values(counts.router)) !== all({ routerId: "all" })) {
        problems.push(`${i}: jumlah router`);
      }
    }
    expect(problems.slice(0, 3)).toEqual([]);
  });

  test("tanpa saringan angka pilihan sama dengan isi tabel, dan tidak ada yang terlewat", () => {
    const counts = billingFacetCounts(rows, defaultBillingFilters);
    expect(counts.total).toBe(rows.length);
    expect(counts.status.lunas + counts.status.isolir).toBe(rows.length);
    expect(
      counts.match.exact + counts.match.normalized + counts.match.none,
    ).toBe(rows.length);
    expect(Object.values(counts.router).reduce((a, b) => a + b, 0)).toBe(
      rows.length,
    );
    expect(formatInteger(counts.total)).toBe("100");
  });

  test("daftar router: tanpa kembar, urut nama, dan sama dengan router di data", () => {
    expect(routers.map((router) => router.id).sort()).toEqual(
      mockRouters.map((router) => router.id).sort(),
    );
    expect(routers.map((router) => router.name)).toEqual(
      [...routers.map((router) => router.name)].sort((a, b) =>
        a.localeCompare(b, "id", { numeric: true }),
      ),
    );
    expect(billingRouters([])).toEqual([]);
  });

  test("tidak mengubah masukan, dan teks pencarian tidak memuat undefined atau null", () => {
    const frozen = deepFreeze(rows.map((row) => ({ ...row })));
    const before = JSON.stringify(frozen);
    filterBillingRows(frozen, { ...defaultBillingFilters, query: "a" });
    billingFacetCounts(frozen, defaultBillingFilters);
    billingRouters(frozen);
    expect(JSON.stringify(frozen)).toBe(before);
    for (const row of rows) {
      const text = billingSearchText(row);
      expect(text).not.toContain("undefined");
      expect(text).not.toContain("null");
      expect(text).toBe(text.toLowerCase());
    }
    expect(billingSearchTerms("  Budi   SANTOSO ")).toEqual([
      "budi",
      "santoso",
    ]);
    expect(billingSearchTerms("   ")).toEqual([]);
  });
});
