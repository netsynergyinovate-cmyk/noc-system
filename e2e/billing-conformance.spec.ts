import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  matchBilling,
  normalizePppoe,
  type BillingCustomer,
  type BillingRecord,
} from "../src/lib/dashboard/billing";
import type { BillingStatus } from "../src/lib/dashboard/types";

// Bukti bahwa pencocokan tagihan di backend Go sama dengan matchBilling di TS.
//
// Berkas contoh backend/internal/billing/testdata/match_cases.json berisi
// kasus (pelanggan dan tagihan) beserta jawabannya, dan jawabannya dibuat dari
// matchBilling YANG ASLI. Tes Go TestMatchInvoicesConformsToFixture membaca
// berkas yang sama dan menegaskan MatchInvoices menghasilkan jawaban yang sama
// persis. Tes di bawah ini menutup lingkarannya dari sisi TS: dalam mode biasa
// ia MEMBACA berkas itu dan menegaskan matchBilling masih menghasilkan jawaban
// yang tertulis, sehingga mengubah aturan di billing.ts memaksa berkas
// diperbarui (dan dengan itu memaksa Go mengikuti). Menulis ulang berkas:
//
//   UPDATE_BILLING_FIXTURE=1 npm run test:e2e -- e2e/billing-conformance.spec.ts
//
// Bentuk jawaban dipilih supaya bisa dibaca Go. matchBilling sendiri hanya
// memberi baris pelanggan dan daftar tagihan belum cocok (tanpa kandidat), jadi
// skrip ini menurunkan sisanya: urutan menurut urutan tagihan masukan, kandidat
// tiap tagihan belum cocok dari daftar pelanggan (ambiguous: semua pelanggan yang
// kunci rapinya sama; duplicate: pelanggan yang dipakai tagihan lain, dan
// dipastikan memang satu yang sudah dicocokkan oleh matchBilling), ID terurut,
// perubahan status, dan hitungan.

const FIXTURE = fileURLToPath(
  new URL(
    "../backend/internal/billing/testdata/match_cases.json",
    import.meta.url,
  ),
);
const UPDATE = process.env.UPDATE_BILLING_FIXTURE === "1";

interface FixtureCustomer {
  id: string;
  pppoe: string;
  status: BillingStatus;
}
interface FixtureInvoice {
  name: string;
  ref: string;
  status: BillingStatus;
}
interface FixtureMatch {
  customerId: string;
  kind: "exact" | "normalized";
  billingName: string;
  status: BillingStatus;
  ref: string;
}
interface FixtureUnmatched {
  name: string;
  ref: string;
  status: BillingStatus;
  reason: "unknown" | "duplicate" | "ambiguous";
  customerIds: string[];
}
interface FixtureChange {
  customerId: string;
  from: BillingStatus;
  to: BillingStatus;
}
interface FixtureCounts {
  invoices: number;
  matchedExact: number;
  matchedNormalized: number;
  unmatchedUnknown: number;
  unmatchedDuplicate: number;
  unmatchedAmbiguous: number;
  withoutInvoice: number;
  statusesChanged: number;
}
interface FixtureExpected {
  matches: FixtureMatch[];
  unmatched: FixtureUnmatched[];
  withoutInvoice: string[];
  changes: FixtureChange[];
  counts: FixtureCounts;
}
interface CaseInput {
  name: string;
  customers: FixtureCustomer[];
  invoices: FixtureInvoice[];
}
interface FixtureCase extends CaseInput {
  expected: FixtureExpected;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortedIds = (ids: string[]) => [...ids].sort(byText);

// Jawaban menurut matchBilling TS.
function expectedOf(input: CaseInput): FixtureExpected {
  const customers: BillingCustomer[] = input.customers.map((c) => ({
    id: c.id,
    name: c.id,
    pppoeUsername: c.pppoe,
    routerId: "r",
    billingStatus: c.status,
  }));
  const records: BillingRecord[] = input.invoices.map((i) => ({
    invoiceRef: i.ref,
    pppoeUsername: i.name,
    status: i.status,
  }));
  const { rows, unmatched } = matchBilling(customers, records, () => "r");

  const position = new Map(input.invoices.map((inv, index) => [inv.ref, index]));
  if (position.size !== input.invoices.length) {
    throw new Error(`${input.name}: kode tagihan kembar`);
  }
  const at = (ref: string) => position.get(ref)!;
  const statusOf = new Map(input.customers.map((c) => [c.id, c.status]));

  const matchedRows = rows.filter((row) => row.match !== "none");
  const matches: FixtureMatch[] = matchedRows
    .map((row) => ({
      customerId: row.customerId,
      kind: row.match as "exact" | "normalized",
      billingName: row.billingName!,
      status: row.status,
      ref: row.invoiceRef!,
    }))
    .sort((a, b) => at(a.ref) - at(b.ref));

  const candidatesOf = (item: (typeof unmatched)[number]): string[] => {
    const name = item.pppoeUsername;
    if (item.reason === "unknown") return [];
    if (item.reason === "ambiguous") {
      return sortedIds(
        input.customers
          .filter((c) => normalizePppoe(c.pppoe) === normalizePppoe(name))
          .map((c) => c.id),
      );
    }
    // duplicate: pelanggan yang sudah dipakai tagihan lain. Tagihan yang namanya
    // dikenal persis memilih pelanggan itu dengan nama persis, yang lain dengan
    // nama yang dirapikan.
    const exactOwner = input.customers.some((c) => c.pppoe === name);
    const holders = matchedRows.filter((row) =>
      exactOwner
        ? row.pppoeUsername === name
        : normalizePppoe(row.pppoeUsername) === normalizePppoe(name),
    );
    if (holders.length !== 1) {
      throw new Error(`${input.name}: ${item.invoiceRef}: pemegang ganda`);
    }
    return [holders[0].customerId];
  };

  const unmatchedOut: FixtureUnmatched[] = [...unmatched]
    .sort((a, b) => at(a.invoiceRef) - at(b.invoiceRef))
    .map((item) => ({
      name: item.pppoeUsername,
      ref: item.invoiceRef,
      status: item.status,
      reason: item.reason,
      customerIds: candidatesOf(item),
    }));

  const withoutInvoice = sortedIds(
    rows.filter((row) => row.match === "none").map((row) => row.customerId),
  );
  const changes: FixtureChange[] = matches
    .filter((m) => statusOf.get(m.customerId) !== m.status)
    .map((m) => ({
      customerId: m.customerId,
      from: statusOf.get(m.customerId)!,
      to: m.status,
    }));
  const reasons = (reason: FixtureUnmatched["reason"]) =>
    unmatchedOut.filter((u) => u.reason === reason).length;
  return {
    matches,
    unmatched: unmatchedOut,
    withoutInvoice,
    changes,
    counts: {
      invoices: input.invoices.length,
      matchedExact: matches.filter((m) => m.kind === "exact").length,
      matchedNormalized: matches.filter((m) => m.kind === "normalized").length,
      unmatchedUnknown: reasons("unknown"),
      unmatchedDuplicate: reasons("duplicate"),
      unmatchedAmbiguous: reasons("ambiguous"),
      withoutInvoice: withoutInvoice.length,
      statusesChanged: changes.length,
    },
  };
}

// --- Kasus -------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const cust = (
  n: number,
  pppoe: string,
  status: BillingStatus = "lunas",
): FixtureCustomer => ({ id: uuid(n), pppoe, status });
const inv = (
  n: number,
  name: string,
  status: BillingStatus = "lunas",
): FixtureInvoice => ({ name, ref: `INV-${n}`, status });

// Semua kasus tangan dari e2e/billing.spec.ts, dalam bentuk netral.
function handCases(): CaseInput[] {
  const cases: CaseInput[] = [];
  const add = (
    name: string,
    customers: FixtureCustomer[],
    invoices: FixtureInvoice[],
  ) => cases.push({ name: `tangan: ${name}`, customers, invoices });

  add(
    "nama persis cocok, status dan kode dari tagihan",
    [cust(1, "user1", "lunas")],
    [inv(1, "user1", "isolir")],
  );
  add(
    "pelanggan tanpa tagihan tidak berubah",
    [cust(1, "user1", "isolir"), cust(2, "user2", "lunas")],
    [inv(2, "user2")],
  );
  for (const written of [
    "USER1",
    "User1",
    " user1",
    "user1 ",
    "  User1  ",
    "\tuser1\n",
  ]) {
    add(
      `dirapikan ${JSON.stringify(written)}`,
      [cust(1, "user1")],
      [inv(1, written, "isolir")],
    );
  }
  for (const written of [
    "us er1",
    "user 1",
    "user",
    "user11",
    "user-1",
    "",
  ]) {
    add(
      `tidak dimaafkan ${JSON.stringify(written)}`,
      [cust(1, "user1")],
      [inv(1, written)],
    );
  }
  add(
    "tagihan tanpa pelanggan",
    [cust(1, "user1"), cust(2, "user2", "isolir")],
    [inv(9, "orang.asing", "isolir")],
  );
  const loose = inv(1, "USER1");
  const exact = inv(2, "user1", "isolir");
  add("persis menang atas dirapikan (dirapikan dulu)", [cust(1, "user1")], [
    loose,
    exact,
  ]);
  add("persis menang atas dirapikan (persis dulu)", [cust(1, "user1")], [
    exact,
    loose,
  ]);
  const first = inv(1, "user1");
  const second = inv(2, "user1", "isolir");
  add("dua persis (urutan asli)", [cust(1, "user1")], [first, second]);
  add("dua persis (dibalik)", [cust(1, "user1")], [second, first]);
  add(
    "dua dirapikan ke pelanggan yang sama",
    [cust(1, "user1")],
    [inv(1, " user1"), inv(2, "USER1")],
  );
  add(
    "dua dirapikan ke pelanggan yang sama (dibalik)",
    [cust(1, "user1")],
    [inv(2, "USER1"), inv(1, " user1")],
  );
  for (const written of ["BUDI01", " budi01", "bUDI01"]) {
    add(
      `ambigu ${JSON.stringify(written)}`,
      [cust(1, "Budi01"), cust(2, "budi01")],
      [inv(1, written)],
    );
  }
  add(
    "ambigu: yang ditulis persis tetap dikenali",
    [cust(1, "Budi01"), cust(2, "budi01")],
    [inv(2, "budi01"), inv(1, "Budi01")],
  );
  add(
    "ambigu tiga pelanggan",
    [cust(3, "BUDI01"), cust(1, "Budi01"), cust(2, "budi01")],
    [inv(1, "bUdI01")],
  );
  add(
    "ambigu karena spasi di ujung nama pelanggan",
    [cust(1, " user1"), cust(2, "user1")],
    [inv(1, "USER1"), inv(2, " user1"), inv(3, "user1")],
  );
  add(
    "nama pelanggan huruf besar",
    [cust(1, "USER1")],
    [inv(1, "user1"), inv(2, "USER1")],
  );
  add("tanpa pelanggan dan tanpa tagihan", [], []);
  add("hanya pelanggan", [cust(1, "a"), cust(2, "b", "isolir")], []);
  add("hanya tagihan", [], [inv(1, "a"), inv(2, "a"), inv(3, "")]);
  add(
    "campuran",
    [
      cust(1, "ani", "isolir"),
      cust(2, "Budi"),
      cust(3, "budi"),
      cust(4, "citra"),
      cust(5, "dewi", "isolir"),
      cust(6, "eko"),
    ],
    [
      inv(1, "ANI", "lunas"),
      inv(2, "ani", "isolir"),
      inv(3, "BUDI"),
      inv(4, "citra "),
      inv(5, "Citra"),
      inv(6, "dewi", "lunas"),
      inv(7, "fajar"),
      inv(8, "dewi", "isolir"),
    ],
  );
  return cases;
}

// Teks yang paling mungkin membedakan trim dan toLowerCase JavaScript dari
// pustaka bahasa lain. Tiap teks dipakai dalam dua kasus: sebagai tagihan untuk
// pelanggan yang namanya sudah dirapikan oleh JavaScript, dan sebagai nama
// pelanggan untuk tagihan yang ditulis huruf besar dan huruf kecil.
const UNICODE_SAMPLES = [
  "İSTANBUL",
  "İ",
  "I",
  "ı",
  "Σ",
  "ΑΣ",
  "ΑΣ ",
  "ΑΣΑ",
  "ΟΔΟΣ",
  "ΟΔΟΣ ΑΣ",
  "ΑΣ.",
  "Α.Σ",
  "ΑΣ.Α",
  "ΑΣ'Α",
  "ΑΣ\u0301",
  "ΑΣ\u0301Α",
  "ΑΣ1",
  "1Σ",
  "ΣΑ",
  "ὈΔΥΣΣΕΎΣ",
  "Straße",
  "STRASSE",
  "ǅ",
  "Ǆ",
  "ǆ",
  "Ångström",
  "KELVIN",
  "ΩMEGA",
  "ＵＳＥＲ１",
  "ｕｓｅｒ１",
  "𐐀𐐁𐐂",
  "𐐨𐐩",
  "ᲐᲑ",
  "ᎠᎡᎢ",
  "ЖУК",
  "Çağrı",
  "ŞİRKET",
  "ÀÉÎÕÜ",
  "\uFEFFuser1\uFEFF",
  "\u00A0user1\u00A0",
  "\u0085user1\u0085",
  "\u2028user1\u2029",
  "\u3000user1\u3000",
  "\u1680user1",
  "\u2003User1\u200A",
  "\u200Buser1",
  "\u180Euser1",
  "\vuser1\f",
  "USER1\u202F",
  "user\u00A01",
  "\u205Fuser1\u2009",
  "\r\nuser1\r\n",
  "\u0000user1",
  "\u2000",
  "ab\u200Bc",
];

function unicodeCases(): CaseInput[] {
  const cases: CaseInput[] = [];
  UNICODE_SAMPLES.forEach((sample, index) => {
    const tidy = sample.trim().toLowerCase();
    if (tidy.length > 0) {
      cases.push({
        name: `unicode ${index}: pelanggan sudah dirapikan JS, tagihan ${JSON.stringify(sample)}`,
        customers: [cust(1, tidy), cust(2, "lain")],
        invoices: [inv(1, sample, "isolir")],
      });
    }
    cases.push({
      name: `unicode ${index}: pelanggan ${JSON.stringify(sample)}, tagihan huruf besar dan kecil`,
      customers: [cust(1, sample), cust(2, "lain")],
      invoices: [
        inv(1, sample.toUpperCase()),
        inv(2, sample.toLowerCase(), "isolir"),
        inv(3, `  ${sample}  `),
      ],
    });
  });
  // Dua pelanggan yang kunci rapinya sama hanya setelah pemetaan penuh.
  cases.push({
    name: "unicode: kunci rapi sama karena pemetaan penuh",
    customers: [cust(1, "İ"), cust(2, "i\u0307"), cust(3, "i")],
    invoices: [inv(1, "İ"), inv(2, "I\u0307"), inv(3, "I"), inv(4, "ı")],
  });
  cases.push({
    name: "unicode: sigma akhir dan sigma biasa kunci berbeda",
    customers: [cust(1, "ας"), cust(2, "ασ"), cust(3, "σ")],
    invoices: [inv(1, "ΑΣ"), inv(2, "ΑΣΑ"), inv(3, "Σ"), inv(4, "ας")],
  });
  return cases;
}

const POOL = "abcdefghijklmnopqrstuvwxyz0123456789";
const UNICODE_WORDS = [
  "Çağrı",
  "ŞİRKET",
  "İzmir",
  "ΑΣΤΡΟ",
  "Σίσυφος",
  "ὈΔΥΣΣΕΎΣ",
  "Привет",
  "ЖУК",
  "straße",
  "Åsa",
  "Kelvin",
  "ＵＳＥＲ",
  "𐐀𐐁𐐂",
  "ᏣᎳᎩ",
  "ᲐᲑ",
  "Ǆemal",
  "naïve",
  "ÅNGSTRÖM",
];
const RESPELLINGS: ((name: string) => string)[] = [
  (s) => s.toUpperCase(),
  (s) => s.toLowerCase(),
  (s) => ` ${s}`,
  (s) => `${s} `,
  (s) => `\t${s}\n`,
  (s) => `\u00A0${s}`,
  (s) => `\uFEFF${s}`,
  (s) => `${s}\u3000`,
  (s) => `  ${s.toUpperCase()}  `,
  (s) => s.charAt(0).toUpperCase() + s.slice(1),
];

function randomCase(seed: number): CaseInput {
  const random = mulberry32(seed);
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(random() * items.length)];
  const word = () => {
    if (random() < 0.25) return pick(UNICODE_WORDS);
    let text = "";
    const length = 3 + Math.floor(random() * 6);
    for (let i = 0; i < length; i += 1) text += pick([...POOL]);
    if (random() < 0.3) text += pick([".", "_", "-"]) + Math.floor(random() * 99);
    return text;
  };
  const style = (text: string) =>
    pick([
      text,
      text.toLowerCase(),
      text.toUpperCase(),
      text.charAt(0).toUpperCase() + text.slice(1),
    ]);

  const customers: FixtureCustomer[] = [];
  const taken = new Set<string>();
  const addCustomer = (pppoe: string) => {
    if (taken.has(pppoe)) return false;
    taken.add(pppoe);
    customers.push({
      id: uuid(customers.length + 1),
      pppoe,
      status: random() < 0.3 ? "isolir" : "lunas",
    });
    return true;
  };
  const wanted = Math.floor(random() * 24);
  for (let i = 0; i < wanted; i += 1) {
    const base = style(word());
    addCustomer(random() < 0.05 ? ` ${base} ` : base);
  }
  // Kembar yang hanya beda huruf besar atau spasi di ujung.
  for (const original of [...customers]) {
    if (random() < 0.12) {
      addCustomer(pick([original.pppoe.toUpperCase(), ` ${original.pppoe}`]));
    }
  }

  const invoices: FixtureInvoice[] = [];
  const addInvoice = (name: string) =>
    invoices.push({
      name,
      ref: `INV-${invoices.length + 1}`,
      status: random() < 0.35 ? "isolir" : "lunas",
    });
  for (const c of customers) {
    const roll = random();
    if (roll < 0.2) continue;
    if (roll < 0.5) addInvoice(c.pppoe);
    else if (roll < 0.8) addInvoice(pick(RESPELLINGS)(c.pppoe));
    else addInvoice(c.pppoe.length > 1 ? c.pppoe.slice(0, -1) : `${c.pppoe}x`);
    if (random() < 0.12) addInvoice(pick(RESPELLINGS)(c.pppoe));
    if (random() < 0.06) addInvoice(c.pppoe);
  }
  const orphans = Math.floor(random() * 4);
  for (let i = 0; i < orphans; i += 1) {
    addInvoice(pick([`orang.asing${i}`, "", "   ", pick(UNICODE_WORDS)]));
  }

  // Urutan tagihan dan pelanggan acak: tagihan menentukan pemenang bila berebut,
  // pelanggan tidak boleh berpengaruh.
  const shuffle = <T>(items: T[]) => {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  };
  shuffle(invoices);
  shuffle(customers);
  return { name: `acak ${seed}`, customers, invoices };
}

const RANDOM_CASES = 400;

function allInputs(): CaseInput[] {
  const cases = [...handCases(), ...unicodeCases()];
  for (let seed = 1; seed <= RANDOM_CASES; seed += 1) {
    cases.push(randomCase(seed));
  }
  return cases;
}

const inputOf = ({ name, customers, invoices }: CaseInput): CaseInput => ({
  name,
  customers,
  invoices,
});

function serialize(cases: FixtureCase[]) {
  return `[\n${cases.map((c) => `  ${JSON.stringify(c)}`).join(",\n")}\n]\n`;
}

test.describe("pencocokan tagihan: bukti kesamaan dengan backend Go", () => {
  test("berkas contoh sama dengan keluaran matchBilling untuk setiap kasus", () => {
    const generated: FixtureCase[] = allInputs().map((input) => ({
      ...input,
      expected: expectedOf(input),
    }));
    if (UPDATE) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, serialize(generated), "utf8");
    }

    const stored = JSON.parse(readFileSync(FIXTURE, "utf8")) as FixtureCase[];
    const hint =
      "berkas contoh tidak sesuai; jalankan UPDATE_BILLING_FIXTURE=1 npm run test:e2e -- e2e/billing-conformance.spec.ts";

    // Kasus di berkas sama dengan yang dibuat spesifikasi ini.
    expect(stored.length, hint).toBe(generated.length);
    const drift = generated
      .filter(
        (c, i) =>
          JSON.stringify(inputOf(c)) !== JSON.stringify(inputOf(stored[i])),
      )
      .map((c) => c.name);
    expect(drift.slice(0, 5), hint).toEqual([]);

    // Jawaban di berkas sama dengan keluaran matchBilling saat ini.
    for (const item of stored) {
      expect(expectedOf(inputOf(item)), `${item.name}: ${hint}`).toEqual(
        item.expected,
      );
    }
  });

  test("berkas contoh memuat semua keadaan, sehingga kesamaan itu bermakna", () => {
    const stored = JSON.parse(readFileSync(FIXTURE, "utf8")) as FixtureCase[];
    expect(stored.length).toBeGreaterThanOrEqual(450);
    const total = (pick: (counts: FixtureCounts) => number) =>
      stored.reduce((sum, c) => sum + pick(c.expected.counts), 0);
    expect(total((c) => c.matchedExact)).toBeGreaterThan(300);
    expect(total((c) => c.matchedNormalized)).toBeGreaterThan(300);
    expect(total((c) => c.unmatchedUnknown)).toBeGreaterThan(100);
    expect(total((c) => c.unmatchedDuplicate)).toBeGreaterThan(50);
    expect(total((c) => c.unmatchedAmbiguous)).toBeGreaterThan(30);
    expect(total((c) => c.withoutInvoice)).toBeGreaterThan(100);
    expect(total((c) => c.statusesChanged)).toBeGreaterThan(100);
    const text = stored.map((c) => JSON.stringify(c)).join("");
    // Huruf di luar ASCII dan spasi yang bukan spasi biasa benar-benar ikut.
    expect([...text].some((ch) => ch.codePointAt(0)! > 0x7f)).toBe(true);
    expect(text.includes("\\u")).toBe(true);
  });

  test("setiap tagihan berakhir di tepat satu tempat dan hitungannya cocok di semua kasus", () => {
    const stored = JSON.parse(readFileSync(FIXTURE, "utf8")) as FixtureCase[];
    const problems: string[] = [];
    for (const item of stored) {
      const placed = [
        ...item.expected.matches.map((m) => m.ref),
        ...item.expected.unmatched.map((u) => u.ref),
      ];
      if (
        placed.length !== item.invoices.length ||
        new Set(placed).size !== placed.length
      ) {
        problems.push(`${item.name}: tagihan`);
      }
      const matched = new Set(item.expected.matches.map((m) => m.customerId));
      if (matched.size !== item.expected.matches.length) {
        problems.push(`${item.name}: pelanggan ganda`);
      }
      if (
        matched.size + item.expected.withoutInvoice.length !==
        item.customers.length
      ) {
        problems.push(`${item.name}: pelanggan`);
      }
      const counts = item.expected.counts;
      if (
        counts.invoices !==
        counts.matchedExact +
          counts.matchedNormalized +
          counts.unmatchedUnknown +
          counts.unmatchedDuplicate +
          counts.unmatchedAmbiguous
      ) {
        problems.push(`${item.name}: jumlah`);
      }
      for (const u of item.expected.unmatched) {
        const want =
          u.reason === "unknown" ? 0 : u.reason === "duplicate" ? 1 : 2;
        const ok =
          u.reason === "ambiguous"
            ? u.customerIds.length >= want
            : u.customerIds.length === want;
        if (!ok) problems.push(`${item.name}: kandidat ${u.ref}`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
  });
});
