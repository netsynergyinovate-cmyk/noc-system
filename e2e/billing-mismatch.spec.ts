import { expect, test } from "@playwright/test";
import {
  mockBillingOverview,
  normalizePppoe,
  type BillingRow,
  type BillingUnmatched,
} from "../src/lib/dashboard/billing";
import {
  MISMATCH_MAX_DISTANCE,
  buildMismatches,
  describeMismatches,
  editDistance,
  filterMismatches,
  mismatchAdvice,
  mismatchKinds,
  mismatchLabels,
  summarizeMismatches,
  type BillingMismatch,
  type MismatchKind,
} from "../src/lib/dashboard/billing-mismatch";
import { BILLING_START } from "./billing-moments";

// Daftar ketidakcocokan antara tagihan dan pelanggan, tanpa browser: jarak nama,
// pemasangan tagihan dengan pelanggan yang kemungkinan satu masalah, dan kalimat
// ringkasan serta sarannya.

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

// Pembanding jarak yang ditulis lain: tabel penuh, tanpa batas.
function referenceDistance(a: string, b: string) {
  const table = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i += 1) table[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) table[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      table[i][j] = Math.min(
        table[i - 1][j] + 1,
        table[i][j - 1] + 1,
        table[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return table[a.length][b.length];
}

test.describe("jarak antara dua nama", () => {
  test("contoh yang diketahui", () => {
    const cases: [string, string, number][] = [
      ["", "", 0],
      ["", "abc", 3],
      ["abc", "", 3],
      ["budi", "budi", 0],
      ["kitten", "sitting", 3],
      ["flaw", "lawn", 2],
      ["ab", "ba", 2],
      ["abc", "abcd", 1],
      ["abcd", "abc", 1],
      ["abc", "abd", 1],
      ["budi.santoso001", "budi.santoso01", 1],
    ];
    for (const [a, b, expected] of cases) {
      expect(editDistance(a, b), `${a} ${b}`).toBe(expected);
      expect(editDistance(b, a), `${b} ${a}`).toBe(expected);
    }
  });

  test("sama dengan pembanding tabel penuh pada 3000 pasangan acak, dan simetris", () => {
    const random = mulberry32(5);
    const alphabet = "abc .0";
    const word = () =>
      Array.from(
        { length: Math.floor(random() * 9) },
        () => alphabet[Math.floor(random() * alphabet.length)],
      ).join("");
    const problems: string[] = [];
    for (let i = 0; i < 3_000; i += 1) {
      const a = word();
      const b = word();
      const want = referenceDistance(a, b);
      if (editDistance(a, b) !== want) problems.push(`${a}|${b}`);
      if (editDistance(b, a) !== want) problems.push(`${b}|${a} simetri`);
      // Tidak melewati jarak yang sudah tidak mungkin: tepat bila di dalam
      // batas, dan selalu lebih dari batas bila di luarnya.
      const limit = Math.floor(random() * 5);
      const got = editDistance(a, b, limit);
      if (want <= limit ? got !== want : got <= limit) {
        problems.push(`${a}|${b} batas ${limit}: ${got} (${want})`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });

  test("batas menghentikan hitungan lebih awal dan hasilnya lebih dari batas", () => {
    expect(editDistance("kitten", "sitting", 3)).toBe(3);
    expect(editDistance("kitten", "sitting", 2)).toBeGreaterThan(2);
    expect(editDistance("a", "abcdefgh", 2)).toBeGreaterThan(2);
    expect(editDistance("abc", "abc", 0)).toBe(0);
    expect(editDistance("abc", "abd", 0)).toBeGreaterThan(0);
  });
});

const row = (n: number, extra: Partial<BillingRow> = {}): BillingRow => ({
  customerId: `c${n}`,
  name: `Pelanggan ${n}`,
  pppoeUsername: `user${n}`,
  routerId: "r1",
  routerName: "Router 1",
  status: "lunas",
  match: "none",
  invoiceRef: null,
  billingName: null,
  ...extra,
});

const invoice = (
  invoiceRef: string,
  pppoeUsername: string,
  reason: BillingUnmatched["reason"] = "unknown",
  status: BillingUnmatched["status"] = "lunas",
): BillingUnmatched => ({ invoiceRef, pppoeUsername, status, reason });

const kinds = (list: BillingMismatch[]) => list.map((item) => item.kind);

test.describe("pemasangan tagihan tanpa pelanggan dengan pelanggan tanpa tagihan", () => {
  test("nama yang beda satu huruf dipasangkan, dengan nama di billing dibiarkan apa adanya", () => {
    const rows = [row(1, { name: "Budi", pppoeUsername: "budi.santoso001" })];
    const list = buildMismatches(rows, [invoice("INV-1", "budi.santoso01")]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: "pair|INV-1|c1",
      kind: "pair",
      distance: 1,
      invoice: {
        invoiceRef: "INV-1",
        pppoeUsername: "budi.santoso01",
        status: "lunas",
      },
    });
    expect(list[0].customers).toEqual([
      {
        customerId: "c1",
        name: "Budi",
        pppoeUsername: "budi.santoso001",
        routerName: "Router 1",
        invoiceRef: null,
      },
    ]);
  });

  test("huruf besar dan spasi di ujung tidak dihitung sebagai perbedaan", () => {
    const rows = [row(1, { pppoeUsername: "budi.santoso001" })];
    const list = buildMismatches(rows, [invoice("INV-1", "  BUDI.SANTOSO01 ")]);
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("pair");
    expect(list[0].distance).toBe(1);
    expect(list[0].invoice!.pppoeUsername).toBe("  BUDI.SANTOSO01 ");
  });

  test("dua huruf berbeda masih dipasangkan, tiga tidak", () => {
    expect(MISMATCH_MAX_DISTANCE).toBe(2);
    const rows = [row(1, { pppoeUsername: "abcdefgh" })];
    const two = buildMismatches(rows, [invoice("INV-1", "abcdexyh")]);
    expect(kinds(two)).toEqual(["pair"]);
    expect(two[0].distance).toBe(2);
    const three = buildMismatches(rows, [invoice("INV-1", "abcdxyzh")]);
    expect(kinds(three)).toEqual([
      "invoice-unknown",
      "customer-without-invoice",
    ]);
  });

  test("tagihan yang sama dekatnya dengan dua pelanggan tidak ditebak", () => {
    const rows = [
      row(1, { pppoeUsername: "budi.santoso001" }),
      row(2, { pppoeUsername: "budi.santoso002" }),
    ];
    const list = buildMismatches(rows, [invoice("INV-1", "budi.santoso00")]);
    expect(kinds(list)).toEqual([
      "invoice-unknown",
      "customer-without-invoice",
      "customer-without-invoice",
    ]);
  });

  test("pelanggan yang sama dekatnya dengan dua tagihan tidak ditebak", () => {
    const rows = [row(1, { pppoeUsername: "budi.santoso001" })];
    const list = buildMismatches(rows, [
      invoice("INV-1", "budi.santoso00"),
      invoice("INV-2", "budi.santoso01"),
    ]);
    // Kedua tagihan sama dekatnya (satu huruf) dengan satu-satunya pelanggan.
    expect(kinds(list)).toEqual([
      "invoice-unknown",
      "invoice-unknown",
      "customer-without-invoice",
    ]);
  });

  test("hanya yang saling paling dekat dan satu-satunya yang dipasangkan; yang lain tetap berdiri sendiri", () => {
    const rows = [
      row(1, { pppoeUsername: "abcdef" }),
      row(2, { pppoeUsername: "abcxyz" }),
    ];
    const list = buildMismatches(rows, [
      invoice("INV-1", "abcdeg"),
      invoice("INV-2", "abcxyg"),
    ]);
    expect(
      list.map((item) => [
        item.invoice?.invoiceRef,
        item.customers[0].customerId,
      ]),
    ).toEqual([
      ["INV-1", "c1"],
      ["INV-2", "c2"],
    ]);
    expect(kinds(list)).toEqual(["pair", "pair"]);

    // INV-1 paling dekat ke c1 (dua huruf), tetapi c1 lebih dekat ke INV-2
    // (satu huruf): INV-2 yang dipasangkan, INV-1 tetap tanpa pelanggan.
    const crowded = buildMismatches(
      [row(1, { pppoeUsername: "abcdef" })],
      [invoice("INV-1", "abcdxy"), invoice("INV-2", "abcdeg")],
    );
    expect(
      crowded.map((item) => [item.kind, item.invoice?.invoiceRef]),
    ).toEqual([
      ["pair", "INV-2"],
      ["invoice-unknown", "INV-1"],
    ]);
  });

  test("tagihan ganda menyebut pelanggan yang sudah memakai tagihan lain, dan yang ambigu menyebut semua yang cocok", () => {
    const rows = [
      row(1, {
        pppoeUsername: "budi01",
        match: "exact",
        invoiceRef: "INV-9",
        billingName: "budi01",
      }),
      row(2, { pppoeUsername: "Ani01" }),
      row(3, { pppoeUsername: "ani01" }),
    ];
    const list = buildMismatches(rows, [
      invoice("INV-10", "budi01", "duplicate"),
      invoice("INV-11", "ANI01", "ambiguous"),
    ]);
    const duplicate = list.find((item) => item.kind === "invoice-duplicate")!;
    expect(duplicate.customers.map((customer) => customer.customerId)).toEqual([
      "c1",
    ]);
    expect(duplicate.customers[0].invoiceRef).toBe("INV-9");
    expect(mismatchAdvice(duplicate)).toContain("INV-9");
    const ambiguous = list.find((item) => item.kind === "invoice-ambiguous")!;
    expect(
      ambiguous.customers.map((customer) => customer.customerId).sort(),
    ).toEqual(["c2", "c3"]);
    // Kedua pelanggan tanpa tagihan itu tetap tampil di sisi mereka sendiri.
    expect(
      list
        .filter((item) => item.kind === "customer-without-invoice")
        .map((item) => item.customers[0].customerId)
        .sort(),
    ).toEqual(["c2", "c3"]);
  });

  test("pelanggan yang sudah cocok tidak tampil, dan pelanggan tanpa tagihan tampil sendiri", () => {
    const rows = [
      row(1, { match: "exact", invoiceRef: "INV-1", billingName: "user1" }),
      row(2, {
        match: "normalized",
        invoiceRef: "INV-2",
        billingName: " USER2",
      }),
      row(3),
    ];
    const list = buildMismatches(rows, []);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: "customer|c3",
      kind: "customer-without-invoice",
      invoice: null,
      distance: null,
    });
    expect(buildMismatches([], [])).toEqual([]);
    expect(buildMismatches(rows.slice(0, 2), [])).toEqual([]);
  });

  test("urut menurut jenis, lalu kode tagihan atau nama pelanggan, dengan angka menurut nilainya", () => {
    const rows = [
      row(1, { name: "Zaki", pppoeUsername: "zaki" }),
      row(2, { name: "Ali", pppoeUsername: "ali" }),
      row(3, { name: "Mira", pppoeUsername: "mirax001" }),
    ];
    const list = buildMismatches(rows, [
      invoice("INV-10", "yyyyyyyy"),
      invoice("INV-9", "xxxxxxxx"),
      invoice("INV-2", "mirax01"),
      invoice("INV-5", "qqqqqq", "duplicate"),
    ]);
    expect(
      list.map((item) => [
        item.kind,
        item.invoice?.invoiceRef ?? item.customers[0].name,
      ]),
    ).toEqual([
      ["pair", "INV-2"],
      ["invoice-unknown", "INV-9"],
      ["invoice-unknown", "INV-10"],
      ["invoice-duplicate", "INV-5"],
      ["customer-without-invoice", "Ali"],
      ["customer-without-invoice", "Zaki"],
    ]);
  });

  test("tidak mengubah masukan", () => {
    const rows = deepFreeze([
      row(1, { pppoeUsername: "budi.santoso001" }),
      row(2),
    ]);
    const unmatched = deepFreeze([invoice("INV-1", "budi.santoso01")]);
    const before = JSON.stringify([rows, unmatched]);
    buildMismatches(rows, unmatched);
    expect(JSON.stringify([rows, unmatched])).toBe(before);
  });
});

// Data acak: pelanggan tanpa tagihan, yang sudah cocok, dan tagihan yang salah
// ketik atau tak bertuan.
function randomScenario(seed: number) {
  const random = mulberry32(seed);
  const alphabet = "abcde012";
  const word = (length: number) =>
    Array.from(
      { length },
      () => alphabet[Math.floor(random() * alphabet.length)],
    ).join("");
  const count = 3 + Math.floor(random() * 25);
  const names = new Set<string>();
  const rows: BillingRow[] = [];
  while (rows.length < count) {
    const name = word(4 + Math.floor(random() * 4));
    if (names.has(name)) continue;
    names.add(name);
    const matched = random() < 0.4;
    rows.push(
      row(rows.length, {
        pppoeUsername: name,
        match: matched ? "exact" : "none",
        invoiceRef: matched ? `INV-H${rows.length}` : null,
        billingName: matched ? name : null,
      }),
    );
  }
  const unmatched: BillingUnmatched[] = [];
  const edit = (name: string) => {
    const at = Math.floor(random() * name.length);
    const pick = random();
    if (pick < 0.34) return name.slice(0, at) + name.slice(at + 1);
    if (pick < 0.67) return name.slice(0, at) + word(1) + name.slice(at);
    return name.slice(0, at) + word(1) + name.slice(at + 1);
  };
  const reasons = [
    "unknown",
    "unknown",
    "unknown",
    "duplicate",
    "ambiguous",
  ] as const;
  for (let i = 0; i < Math.floor(random() * 14); i += 1) {
    const base = rows[Math.floor(random() * rows.length)].pppoeUsername;
    const written = random() < 0.7 ? edit(base) : word(5);
    // Nama yang kebetulan sama dengan pelanggan lain bukan "tak bertuan".
    if (names.has(normalizePppoe(written))) continue;
    unmatched.push(
      invoice(
        `INV-${i}`,
        written,
        reasons[Math.floor(random() * reasons.length)],
      ),
    );
  }
  return { rows, unmatched };
}

test.describe("daftar ketidakcocokan pada data acak", () => {
  test("tiap tagihan yang belum cocok dan tiap pelanggan tanpa tagihan muncul tepat satu kali", () => {
    const problems: string[] = [];
    let pairs = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const { rows, unmatched } = randomScenario(seed);
      const list = buildMismatches(rows, unmatched);
      const invoices = list.flatMap((item) =>
        item.invoice ? [item.invoice.invoiceRef] : [],
      );
      if (
        JSON.stringify([...invoices].sort()) !==
        JSON.stringify(unmatched.map((item) => item.invoiceRef).sort())
      ) {
        problems.push(`${seed}: tagihan`);
      }
      const own = list
        .filter(
          (item) =>
            item.kind === "pair" || item.kind === "customer-without-invoice",
        )
        .map((item) => item.customers[0].customerId)
        .sort();
      const none = rows
        .filter((r) => r.match === "none")
        .map((r) => r.customerId)
        .sort();
      if (JSON.stringify(own) !== JSON.stringify(none))
        problems.push(`${seed}: pelanggan`);
      pairs += list.filter((item) => item.kind === "pair").length;
      // Jumlah baris = tagihan + pelanggan tanpa tagihan - pasangan.
      if (
        list.length !==
        unmatched.length +
          none.length -
          list.filter((i) => i.kind === "pair").length
      ) {
        problems.push(`${seed}: jumlah`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    // Datanya memuat pasangan, jadi pengujian ini bermakna.
    expect(pairs).toBeGreaterThan(100);
  });

  test("pasangan sama dengan pembanding yang ditulis lain: saling paling dekat, satu-satunya, dan paling jauh dua huruf", () => {
    const problems: string[] = [];
    for (let seed = 1; seed <= 400; seed += 1) {
      const { rows, unmatched } = randomScenario(seed);
      const none = rows.filter((r) => r.match === "none");
      const unknown = unmatched.filter((u) => u.reason === "unknown");
      const d = (u: BillingUnmatched, r: BillingRow) =>
        referenceDistance(
          normalizePppoe(u.pppoeUsername),
          normalizePppoe(r.pppoeUsername),
        );
      const expected = new Set<string>();
      for (const u of unknown) {
        const near = none.map((r) => d(u, r));
        const best = Math.min(...near);
        if (best > 2 || near.filter((x) => x === best).length !== 1) continue;
        const r = none[near.indexOf(best)];
        const back = unknown.map((x) => d(x, r));
        const backBest = Math.min(...back);
        if (
          back.filter((x) => x === backBest).length !== 1 ||
          unknown[back.indexOf(backBest)] !== u
        )
          continue;
        expected.add(`${u.invoiceRef}|${r.customerId}`);
      }
      const got = new Set(
        buildMismatches(rows, unmatched)
          .filter((item) => item.kind === "pair")
          .map(
            (item) =>
              `${item.invoice!.invoiceRef}|${item.customers[0].customerId}`,
          ),
      );
      if (
        JSON.stringify([...got].sort()) !== JSON.stringify([...expected].sort())
      ) {
        problems.push(
          `${seed}: ${[...got].join(",")} != ${[...expected].join(",")}`,
        );
      }
    }
    expect(problems.slice(0, 3)).toEqual([]);
  });

  test("urutan masukan tidak memengaruhi hasil", () => {
    const problems: string[] = [];
    for (let seed = 1; seed <= 200; seed += 1) {
      const { rows, unmatched } = randomScenario(seed);
      const base = JSON.stringify(buildMismatches(rows, unmatched));
      const shuffled = JSON.stringify(
        buildMismatches([...rows].reverse(), [...unmatched].reverse()),
      );
      if (base !== shuffled) problems.push(String(seed));
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });
});

test.describe("data billing tiruan", () => {
  const overview = mockBillingOverview(BILLING_START);
  const list = buildMismatches(overview.rows, overview.unmatched);
  const counts = summarizeMismatches(list);

  test("memuat jenis yang diperlukan, dan jumlahnya cocok dengan dua sisi", () => {
    const none = overview.rows.filter((r) => r.match === "none").length;
    expect(counts.pair).toBeGreaterThanOrEqual(1);
    expect(counts["invoice-unknown"]).toBeGreaterThanOrEqual(1);
    expect(counts["invoice-duplicate"]).toBeGreaterThanOrEqual(1);
    expect(counts["customer-without-invoice"]).toBeGreaterThanOrEqual(1);
    expect(counts.total).toBe(list.length);
    expect(list.length).toBe(overview.unmatched.length + none - counts.pair);
    expect(
      counts.pair +
        counts["invoice-unknown"] +
        counts["invoice-duplicate"] +
        counts["invoice-ambiguous"],
    ).toBe(overview.unmatched.length);
    expect(counts.pair + counts["customer-without-invoice"]).toBe(none);
  });

  test("tiap pasangan adalah salah ketik satu huruf, dan tagihan ganda menyebut tagihan yang dipakai pelanggannya", () => {
    for (const item of list.filter((x) => x.kind === "pair")) {
      expect(item.distance).toBe(1);
      expect(
        normalizePppoe(item.customers[0].pppoeUsername).startsWith(
          normalizePppoe(item.invoice!.pppoeUsername),
        ),
      ).toBe(true);
      expect(item.customers[0].invoiceRef).toBeNull();
    }
    for (const item of list.filter((x) => x.kind === "invoice-duplicate")) {
      expect(item.customers).toHaveLength(1);
      expect(item.customers[0].invoiceRef).toMatch(/^INV-/);
      expect(item.customers[0].invoiceRef).not.toBe(item.invoice!.invoiceRef);
    }
  });

  test("sama setiap dihitung, dan jenisnya berurutan", () => {
    expect(
      JSON.stringify(buildMismatches(overview.rows, overview.unmatched)),
    ).toBe(JSON.stringify(list));
    const ranks = list.map((item) => mismatchKinds.indexOf(item.kind));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

test.describe("tulisan dan saringan", () => {
  const counts = (partial: Partial<Record<MismatchKind, number>>) => {
    const full = {
      pair: 0,
      "invoice-unknown": 0,
      "invoice-duplicate": 0,
      "invoice-ambiguous": 0,
      "customer-without-invoice": 0,
      ...partial,
    };
    return {
      ...full,
      total: Object.values(full).reduce((sum, n) => sum + n, 0),
    };
  };

  test("kalimat ringkasan menyebut jumlah tiap jenis yang ada, urut, tanpa yang nol", () => {
    expect(describeMismatches(counts({}))).toBe(
      "Semua tagihan dan pelanggan cocok.",
    );
    expect(
      describeMismatches(
        counts({
          pair: 2,
          "invoice-unknown": 2,
          "invoice-duplicate": 6,
          "customer-without-invoice": 4,
        }),
      ),
    ).toBe(
      "14 ketidakcocokan: 2 kemungkinan salah ketik, 2 tagihan tanpa pelanggan, 6 tagihan ganda, 4 pelanggan tanpa tagihan.",
    );
    expect(describeMismatches(counts({ "invoice-ambiguous": 1 }))).toBe(
      "1 ketidakcocokan: 1 tagihan cocok dengan banyak pelanggan.",
    );
    expect(
      describeMismatches(
        counts({ "customer-without-invoice": 1_234, pair: 1 }),
      ),
    ).toBe(
      "1.235 ketidakcocokan: 1 kemungkinan salah ketik, 1.234 pelanggan tanpa tagihan.",
    );
  });

  test("tiap jenis punya nama yang berbeda dan saran yang menyebut apa yang dibetulkan", () => {
    expect(
      new Set(mismatchKinds.map((kind) => mismatchLabels[kind])).size,
    ).toBe(5);
    const base = {
      id: "x",
      distance: null,
      invoice: {
        invoiceRef: "INV-1",
        pppoeUsername: "abc",
        status: "lunas" as const,
      },
      customers: [
        {
          customerId: "c1",
          name: "A",
          pppoeUsername: "abcd",
          routerName: "R",
          invoiceRef: null,
        },
      ],
    };
    expect(mismatchAdvice({ ...base, kind: "pair" })).toBe(
      "Samakan nama PPPoE di billing menjadi abcd.",
    );
    expect(
      mismatchAdvice({ ...base, kind: "invoice-unknown", customers: [] }),
    ).toMatch(/^Tidak ada pelanggan/);
    expect(
      mismatchAdvice({
        ...base,
        kind: "invoice-duplicate",
        customers: [{ ...base.customers[0], invoiceRef: "INV-7" }],
      }),
    ).toBe(
      "Pelanggan ini sudah memakai tagihan INV-7. Hapus atau gabungkan tagihan ganda di billing.",
    );
    expect(
      mismatchAdvice({ ...base, kind: "invoice-duplicate", customers: [] }),
    ).toContain("tagihan lain");
    expect(mismatchAdvice({ ...base, kind: "invoice-ambiguous" })).toMatch(
      /lebih dari satu pelanggan/,
    );
    expect(
      mismatchAdvice({
        ...base,
        kind: "customer-without-invoice",
        invoice: null,
      }),
    ).toMatch(/^Belum ada tagihan/);
  });

  test("saringan jenis mempertahankan urutan, dan semua mengembalikan salinan", () => {
    const { rows, unmatched } = randomScenario(11);
    const list = buildMismatches(rows, unmatched);
    expect(filterMismatches(list, "all")).toEqual(list);
    expect(filterMismatches(list, "all")).not.toBe(list);
    for (const kind of mismatchKinds) {
      expect(filterMismatches(list, kind)).toEqual(
        list.filter((item) => item.kind === kind),
      );
    }
    const summary = summarizeMismatches(list);
    expect(mismatchKinds.reduce((sum, kind) => sum + summary[kind], 0)).toBe(
      summary.total,
    );
  });
});
