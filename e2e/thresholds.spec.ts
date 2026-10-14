import { expect, test } from "@playwright/test";
import { anomalyRules } from "../src/lib/dashboard/anomalies";
import {
  createThresholdRegistry,
  THRESHOLDS_STORAGE_KEY,
} from "../src/lib/dashboard/threshold-registry";
import {
  changedThresholds,
  cloneThresholds,
  countThresholdErrors,
  defaultThresholds,
  describeChange,
  describeDirection,
  describeLimit,
  describeRule,
  evaluateTexts,
  formatNumber,
  formatSeconds,
  formatValue,
  isDefaultThresholds,
  parseNumberInput,
  parseThresholds,
  ruleKinds,
  sameThresholds,
  serializeThresholds,
  textsFromValues,
  thresholdLimits,
  validateThresholds,
  type ThresholdValues,
} from "../src/lib/dashboard/thresholds";
import type { IncidentKind } from "../src/lib/dashboard/types";

// Logika murni ambang alert (thresholds.ts) dan "database" tiruannya
// (threshold-registry.ts): bawaan, batas, validasi, penguraian teks isian,
// kalimat, perubahan, dan baca/tulis penyimpanan. Tanpa browser.

const KINDS: IncidentKind[] = ["queue", "cpu", "port", "optical", "offline"];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test.describe("nilai bawaan dan batas", () => {
  test("bawaan sama persis dengan anomalyRules untuk kelima aturan", () => {
    const defaults = defaultThresholds();
    expect(Object.keys(defaults)).toEqual(anomalyRules.map((r) => r.kind));
    expect(anomalyRules).toHaveLength(5);
    for (const rule of anomalyRules) {
      expect(defaults[rule.kind]).toEqual({
        threshold: rule.threshold,
        forSeconds: rule.forSeconds,
      });
    }
    // Dan angkanya memang yang tertulis di aturan deteksi.
    expect(defaults).toEqual({
      queue: { threshold: 95, forSeconds: 30 },
      cpu: { threshold: 85, forSeconds: 180 },
      port: { threshold: 20, forSeconds: 60 },
      optical: { threshold: -25, forSeconds: 0 },
      offline: { threshold: null, forSeconds: 30 },
    });
  });

  test("urutan aturan tetap sama dengan anomalyRules", () => {
    expect([...ruleKinds]).toEqual(anomalyRules.map((r) => r.kind));
    expect([...ruleKinds].sort()).toEqual([...KINDS].sort());
  });

  test("setiap pemanggilan memberi salinan baru yang bebas diubah", () => {
    const first = defaultThresholds();
    first.cpu.threshold = 1;
    first.cpu.forSeconds = 1;
    first.offline.forSeconds = 1;
    const second = defaultThresholds();
    expect(second).not.toBe(first);
    expect(second.cpu).not.toBe(first.cpu);
    expect(second.cpu).toEqual({ threshold: 85, forSeconds: 180 });
    expect(second.offline.forSeconds).toBe(30);
    // anomalyRules sendiri tidak ikut berubah.
    expect(anomalyRules.find((r) => r.kind === "cpu")!.threshold).toBe(85);
    expect(isDefaultThresholds(first)).toBe(false);
    expect(isDefaultThresholds(second)).toBe(true);
  });

  test("tabel batas persis sama dengan yang ditetapkan dan beku", () => {
    expect(thresholdLimits).toEqual({
      queue: {
        direction: "above",
        unit: "%",
        threshold: { min: 50, max: 99, step: 1, editable: true },
        forSeconds: { min: 10, max: 600, step: 1, editable: true },
      },
      cpu: {
        direction: "above",
        unit: "%",
        threshold: { min: 50, max: 99, step: 1, editable: true },
        forSeconds: { min: 30, max: 1800, step: 1, editable: true },
      },
      port: {
        direction: "above",
        unit: "error/menit",
        threshold: { min: 1, max: 1000, step: 1, editable: true },
        forSeconds: { min: 30, max: 600, step: 1, editable: true },
      },
      optical: {
        direction: "below",
        unit: "dBm",
        threshold: { min: -40, max: -15, step: 0.5, editable: true },
        forSeconds: { min: 0, max: 0, step: 1, editable: false },
      },
      offline: {
        direction: "above",
        unit: "",
        threshold: null,
        forSeconds: { min: 10, max: 3600, step: 1, editable: true },
      },
    });
    expect(Object.isFrozen(thresholdLimits)).toBe(true);
    for (const limit of Object.values(thresholdLimits)) {
      expect(Object.isFrozen(limit)).toBe(true);
      if (limit.threshold) expect(Object.isFrozen(limit.threshold)).toBe(true);
      expect(Object.isFrozen(limit.forSeconds)).toBe(true);
    }
    // Satuan sama dengan yang dicatat di aturan deteksi, dan bawaan masuk batas.
    for (const rule of anomalyRules) {
      expect(thresholdLimits[rule.kind].unit).toBe(rule.unit);
    }
    expect(validateThresholds(defaultThresholds())).toEqual({});
  });

  test("hanya optical di bawah ambang, dan hanya optical dan offline yang punya kolom tetap", () => {
    const below = KINDS.filter((k) => thresholdLimits[k].direction === "below");
    expect(below).toEqual(["optical"]);
    const fixed = KINDS.flatMap((k) => [
      ...(thresholdLimits[k].threshold === null ? [`${k}.threshold`] : []),
      ...(thresholdLimits[k].forSeconds.editable ? [] : [`${k}.forSeconds`]),
    ]);
    expect(fixed).toEqual(["optical.forSeconds", "offline.threshold"]);
  });
});

// Satu kolom diubah pada salinan bawaan.
function withField(
  kind: IncidentKind,
  field: "threshold" | "forSeconds",
  value: unknown,
): ThresholdValues {
  const values = defaultThresholds();
  (values[kind] as unknown as Record<string, unknown>)[field] = value;
  return values;
}

test.describe("validasi", () => {
  // Kolom yang bisa diubah, dengan batasnya. Ditulis ulang di sini, tidak dibaca
  // dari thresholdLimits, supaya tabel itu sendiri ikut diuji.
  const editable: Array<{
    kind: IncidentKind;
    field: "threshold" | "forSeconds";
    min: number;
    max: number;
    step: number;
  }> = [
    { kind: "queue", field: "threshold", min: 50, max: 99, step: 1 },
    { kind: "queue", field: "forSeconds", min: 10, max: 600, step: 1 },
    { kind: "cpu", field: "threshold", min: 50, max: 99, step: 1 },
    { kind: "cpu", field: "forSeconds", min: 30, max: 1800, step: 1 },
    { kind: "port", field: "threshold", min: 1, max: 1000, step: 1 },
    { kind: "port", field: "forSeconds", min: 30, max: 600, step: 1 },
    { kind: "optical", field: "threshold", min: -40, max: -15, step: 0.5 },
    { kind: "offline", field: "forSeconds", min: 10, max: 3600, step: 1 },
  ];

  for (const { kind, field, min, max, step } of editable) {
    test(`${kind}.${field}: min, max, satu langkah di luar, dan di antara langkah`, () => {
      const errorsFor = (value: unknown) =>
        validateThresholds(withField(kind, field, value))[kind]?.[field];
      expect(errorsFor(min)).toBeUndefined();
      expect(errorsFor(max)).toBeUndefined();
      expect(errorsFor(min + step)).toBeUndefined();
      expect(errorsFor(max - step)).toBeUndefined();
      expect(errorsFor(min - step)).toMatch(/^Harus antara /);
      expect(errorsFor(max + step)).toMatch(/^Harus antara /);
      // Di dalam rentang tetapi bukan kelipatan langkah.
      expect(errorsFor(min + step / 2)).toMatch(
        step === 1 ? /^Harus bilangan bulat\.$/ : /^Harus kelipatan 0,5/,
      );
      // Satu kolom yang salah tidak menandai kolom lain atau aturan lain.
      const all = validateThresholds(withField(kind, field, min - step));
      expect(Object.keys(all)).toEqual([kind]);
      expect(Object.keys(all[kind]!)).toEqual([field]);
      expect(countThresholdErrors(all)).toBe(1);
    });

    test(`${kind}.${field}: bukan angka, NaN, tak hingga, dan tipe lain ditolak`, () => {
      for (const bad of [
        NaN,
        Infinity,
        -Infinity,
        null,
        undefined,
        "70",
        "",
        true,
        [],
        {},
      ]) {
        expect(
          validateThresholds(withField(kind, field, bad))[kind]?.[field],
        ).toBe("Isi dengan angka.");
      }
    });
  }

  test("kolom yang tidak boleh diubah harus sama dengan bawaan", () => {
    // Durasi optical tetap 0 (alert langsung).
    expect(validateThresholds(defaultThresholds())).toEqual({});
    expect(
      validateThresholds(withField("optical", "forSeconds", 1)).optical
        ?.forSeconds,
    ).toBe("Nilai ini tetap 0 detik dan tidak bisa diubah.");
    for (const bad of [1, -1, NaN, null, "0", 0.5]) {
      expect(
        validateThresholds(withField("optical", "forSeconds", bad)).optical
          ?.forSeconds,
      ).toBeDefined();
    }
    // Offline tidak punya ambang angka.
    expect(
      validateThresholds(withField("offline", "threshold", 50)).offline
        ?.threshold,
    ).toBe("Aturan ini tidak punya ambang angka.");
    for (const bad of [0, 30, NaN, undefined, "x"]) {
      expect(
        validateThresholds(withField("offline", "threshold", bad)).offline
          ?.threshold,
      ).toBeDefined();
    }
  });

  test("pesan galat berbahasa Indonesia dengan satuan yang benar", () => {
    const message = (
      kind: IncidentKind,
      field: "threshold" | "forSeconds",
      v: number,
    ) => validateThresholds(withField(kind, field, v))[kind]![field];
    expect(message("cpu", "threshold", 101)).toBe("Harus antara 50% dan 99%.");
    // "Di atas 100%" tidak pernah terjadi: ambang 100 mematikan aturan diam-diam.
    expect(message("cpu", "threshold", 100)).toBe("Harus antara 50% dan 99%.");
    expect(message("queue", "threshold", 100)).toBe(
      "Harus antara 50% dan 99%.",
    );
    expect(message("cpu", "forSeconds", 29)).toBe(
      "Harus antara 30 detik dan 1800 detik.",
    );
    expect(message("port", "threshold", 0)).toBe(
      "Harus antara 1 error/menit dan 1000 error/menit.",
    );
    expect(message("optical", "threshold", -14.5)).toBe(
      "Harus antara -40 dBm dan -15 dBm.",
    );
    expect(message("optical", "threshold", -25.25)).toBe(
      "Harus kelipatan 0,5 dBm.",
    );
    expect(message("queue", "threshold", 80.5)).toBe("Harus bilangan bulat.");
  });

  test("beberapa galat sekaligus dihitung per kolom, dan -0 dan 0 tidak berbeda", () => {
    const values = defaultThresholds();
    values.queue.threshold = 49;
    values.queue.forSeconds = 9;
    values.port.forSeconds = 30.5;
    values.optical.threshold = 0;
    const errors = validateThresholds(values);
    expect(Object.keys(errors)).toEqual(["queue", "port", "optical"]);
    expect(countThresholdErrors(errors)).toBe(4);
    // Bentuk yang tidak lengkap tidak melempar galat.
    expect(() =>
      validateThresholds({} as unknown as ThresholdValues),
    ).not.toThrow();
    expect(
      countThresholdErrors(
        validateThresholds({} as unknown as ThresholdValues),
      ),
    ).toBe(10);
    expect(() =>
      validateThresholds(null as unknown as ThresholdValues),
    ).not.toThrow();
    // Durasi optical tetap 0, dan -0 sama dengan 0.
    expect(validateThresholds(withField("optical", "forSeconds", -0))).toEqual(
      {},
    );
  });
});

test.describe("mengurai teks isian", () => {
  const ok = (text: string, value: number) =>
    test(`"${text}" -> ${value}`, () => {
      expect(parseNumberInput(text)).toEqual({ ok: true, value });
    });
  const bad = (text: string, error: RegExp) =>
    test(`"${text}" ditolak`, () => {
      const result = parseNumberInput(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(error);
    });

  // Diterima: digit ASCII, minus di depan, satu koma atau titik desimal.
  ok("85", 85);
  ok("0", 0);
  ok("007", 7);
  ok("  85  ", 85);
  ok("\t85\n", 85);
  ok("85,5", 85.5);
  ok("85.5", 85.5);
  ok("-25", -25);
  ok("-25,5", -25.5);
  ok("-25.5", -25.5);
  ok("-0", 0);
  ok("0,5", 0.5);
  ok("0.500", 0.5);
  ok("12,5", 12.5);
  ok("1000", 1000);
  ok("10,25", 10.25);
  ok("999,99", 999.99);
  ok("1,5", 1.5);

  // Ditolak: kosong dan hanya spasi.
  bad("", /kosong/);
  bad("   ", /kosong/);
  bad(" ", /kosong/);
  // Notasi ilmiah, heksadesimal, biner, oktal.
  bad("1e2", /angka biasa/);
  bad("1E2", /angka biasa/);
  bad("0x10", /angka biasa/);
  bad("0b11", /angka biasa/);
  // Setengah angka dan sisa huruf.
  bad("85abc", /angka biasa/);
  bad("abc85", /angka biasa/);
  bad("85 abc", /angka biasa/);
  bad("8 5", /angka biasa/);
  bad("85.", /angka biasa/);
  bad(".5", /angka biasa/);
  bad(",5", /angka biasa/);
  bad("85,", /angka biasa/);
  bad("-", /angka biasa/);
  bad("--5", /angka biasa/);
  bad("5-", /angka biasa/);
  bad("+85", /angka biasa/);
  bad("1,5,5", /angka biasa/);
  bad("1.5,5", /angka biasa/);
  bad("NaN", /angka biasa/);
  bad("Infinity", /angka biasa/);
  bad("-Infinity", /angka biasa/);
  // Digit lain (Arab-Indic), minus Unicode, dan angka lebar penuh.
  bad("٨٥", /angka biasa/);
  bad("−25", /angka biasa/);
  bad("８５", /angka biasa/);
  bad("85​", /angka biasa/);
  // Pola ribuan tidak ditebak.
  bad("1.000", /pemisah ribuan/);
  bad("1,000", /pemisah ribuan/);
  bad("12.345", /pemisah ribuan/);
  bad("1.000.000", /pemisah ribuan/);
  bad("-25.500", /pemisah ribuan/);
  // Terlalu besar untuk angka.
  test("400 digit ditolak sebagai terlalu besar", () => {
    const result = parseNumberInput("9".repeat(400));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/terlalu besar/);
  });

  test("teks selain string tidak melempar galat", () => {
    expect(parseNumberInput(undefined as unknown as string).ok).toBe(false);
    expect(parseNumberInput(null as unknown as string).ok).toBe(false);
    expect(parseNumberInput(85 as unknown as string).ok).toBe(false);
  });

  test("penulisan angka dan penguraiannya saling membalik", () => {
    for (const value of [0, 1, 85, -25, -25.5, 0.5, 1000, 1800, -39.5]) {
      const text = formatNumber(value);
      expect(parseNumberInput(text)).toEqual({ ok: true, value });
    }
    expect(formatNumber(-25.5)).toBe("-25,5");
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(1000)).toBe("1000");
  });

  test("hasil bandingan 4000 teks acak dengan pemindai yang ditulis ulang", () => {
    const random = mulberry32(20260101);
    const alphabet = [
      "0",
      "1",
      "2",
      "5",
      "8",
      "9",
      "-",
      ",",
      ".",
      "e",
      "x",
      " ",
      "+",
      "a",
      "٨",
      "−",
    ];
    // Pemindai karakter demi karakter, tanpa regex.
    const reference = (raw: string): number | null => {
      const text = raw.trim();
      let i = 0;
      const negative = text[0] === "-";
      if (negative) i += 1;
      const isDigit = (c: string | undefined) =>
        c !== undefined && c >= "0" && c <= "9";
      const start = i;
      while (isDigit(text[i])) i += 1;
      const intPart = text.slice(start, i);
      if (intPart === "") return null;
      let fracPart: string | null = null;
      if (text[i] === "," || text[i] === ".") {
        i += 1;
        const fracStart = i;
        while (isDigit(text[i])) i += 1;
        fracPart = text.slice(fracStart, i);
        if (fracPart === "") return null;
      }
      if (i !== text.length) return null;
      // Satu kelompok tiga angka setelah 1-3 angka tanpa nol di depan: ribuan.
      if (
        fracPart !== null &&
        fracPart.length === 3 &&
        intPart.length <= 3 &&
        intPart[0] !== "0"
      ) {
        return null;
      }
      const value = Number(
        `${negative ? "-" : ""}${intPart}${fracPart === null ? "" : `.${fracPart}`}`,
      );
      return Number.isFinite(value) ? (value === 0 ? 0 : value) : null;
    };
    let accepted = 0;
    for (let n = 0; n < 4000; n += 1) {
      const length = Math.floor(random() * 8);
      let text = "";
      for (let k = 0; k < length; k += 1) {
        text += alphabet[Math.floor(random() * alphabet.length)];
      }
      const expected = reference(text);
      const actual = parseNumberInput(text);
      if (expected === null) {
        expect(actual.ok, JSON.stringify(text)).toBe(false);
      } else {
        accepted += 1;
        expect(actual, JSON.stringify(text)).toEqual({
          ok: true,
          value: expected,
        });
      }
    }
    // Contoh acak cukup sering sah supaya cabang diterima ikut teruji.
    expect(accepted).toBeGreaterThan(150);
  });
});

test.describe("menilai isian form", () => {
  test("isian sah menjadi angka, isian salah memakai nilai cadangan dan dicatat", () => {
    const saved = defaultThresholds();
    const texts = textsFromValues(saved);
    expect(texts.cpu).toEqual({ threshold: "85", forSeconds: "180" });
    expect(texts.optical).toEqual({ threshold: "-25", forSeconds: "0" });
    expect(texts.offline).toEqual({ threshold: "", forSeconds: "30" });

    texts.cpu.threshold = "70";
    texts.queue.threshold = "abc";
    texts.port.forSeconds = "29";
    texts.optical.threshold = "-25,5";
    const { values, errors } = evaluateTexts(texts, saved);
    expect(values.cpu.threshold).toBe(70);
    expect(values.optical.threshold).toBe(-25.5);
    // Yang salah jatuh ke nilai tersimpan, jadi hasilnya selalu sah.
    expect(values.queue.threshold).toBe(95);
    expect(values.port.forSeconds).toBe(60);
    expect(validateThresholds(values)).toEqual({});
    expect(Object.keys(errors)).toEqual(["queue", "port"]);
    expect(errors.queue?.threshold).toMatch(/angka biasa/);
    expect(errors.port?.forSeconds).toMatch(/^Harus antara 30 detik/);
    expect(countThresholdErrors(errors)).toBe(2);
  });

  test("isian kolom yang tetap diabaikan", () => {
    const saved = defaultThresholds();
    const texts = textsFromValues(saved);
    texts.optical.forSeconds = "999";
    texts.offline.threshold = "abc";
    const { values, errors } = evaluateTexts(texts, saved);
    expect(errors).toEqual({});
    expect(values.optical.forSeconds).toBe(0);
    expect(values.offline.threshold).toBeNull();
  });

  test("tidak mengubah nilai cadangan", () => {
    const saved = defaultThresholds();
    const copy = cloneThresholds(saved);
    const texts = textsFromValues(saved);
    texts.cpu.threshold = "60";
    evaluateTexts(texts, saved);
    expect(saved).toEqual(copy);
  });
});

test.describe("kalimat penjelas", () => {
  test("dengan nilai bawaan maknanya sama dengan anomalyRules[].description", () => {
    const defaults = defaultThresholds();
    for (const rule of anomalyRules) {
      const sentence = describeRule(rule.kind, defaults[rule.kind]);
      if (rule.kind === "port") {
        // Deskripsinya tidak menyebut lama; kalimat ini menambahkannya (60 detik).
        expect(sentence).toBe(`${rule.description} selama 1 menit`);
      } else {
        expect(sentence).toBe(rule.description);
      }
    }
  });

  test("kalimat contoh dari nilai bawaan", () => {
    const d = defaultThresholds();
    expect(describeRule("cpu", d.cpu)).toBe(
      "CPU router di atas 85% selama 3 menit",
    );
    expect(describeRule("optical", d.optical)).toBe(
      "Rx ONU di bawah -25 dBm (bukan CCQ)",
    );
    expect(describeRule("offline", d.offline)).toBe(
      "Pelanggan terputus lebih dari 30 detik",
    );
  });

  test("mengikuti nilai yang diubah, dengan koma desimal", () => {
    expect(describeRule("cpu", { threshold: 70, forSeconds: 300 })).toBe(
      "CPU router di atas 70% selama 5 menit",
    );
    expect(describeRule("queue", { threshold: 90, forSeconds: 90 })).toBe(
      "Pemakaian antrean di atas 90% selama 90 detik",
    );
    expect(describeRule("port", { threshold: 50, forSeconds: 3600 })).toBe(
      "Error interface naik lebih dari 50 per menit selama 1 jam",
    );
    expect(describeRule("optical", { threshold: -27.5, forSeconds: 0 })).toBe(
      "Rx ONU di bawah -27,5 dBm (bukan CCQ)",
    );
    expect(describeRule("offline", { threshold: null, forSeconds: 5400 })).toBe(
      "Pelanggan terputus lebih dari 1 jam 30 menit",
    );
  });

  test("arah dan rentang", () => {
    expect(describeDirection("cpu")).toBe(
      "Alert muncul bila nilai di atas ambang.",
    );
    expect(describeDirection("optical")).toMatch(/di bawah ambang/);
    expect(describeDirection("offline")).toBeNull();
    expect(describeLimit("cpu", "threshold")).toBe(
      "Rentang 50% sampai 99%, bilangan bulat.",
    );
    expect(describeLimit("cpu", "forSeconds")).toBe(
      "Rentang 30 detik sampai 1800 detik, bilangan bulat.",
    );
    expect(describeLimit("optical", "threshold")).toBe(
      "Rentang -40 dBm sampai -15 dBm, kelipatan 0,5.",
    );
    expect(describeLimit("optical", "forSeconds")).toBe(
      "Tetap, tidak bisa diubah.",
    );
    expect(describeLimit("offline", "threshold")).toBe(
      "Tidak ada ambang angka.",
    );
  });

  test("nilai dengan satuannya", () => {
    expect(formatValue("cpu", "threshold", 85)).toBe("85%");
    expect(formatValue("port", "threshold", 20)).toBe("20 error/menit");
    expect(formatValue("optical", "threshold", -25.5)).toBe("-25,5 dBm");
    expect(formatValue("offline", "threshold", null)).toBe("tanpa ambang");
    expect(formatValue("cpu", "forSeconds", 180)).toBe("3 menit");
  });
});

test.describe("formatSeconds", () => {
  const table: Array<[number, string]> = [
    [0, "0 detik"],
    [1, "1 detik"],
    [10, "10 detik"],
    [30, "30 detik"],
    [59, "59 detik"],
    [60, "1 menit"],
    [61, "61 detik"],
    [90, "90 detik"],
    [119, "119 detik"],
    [120, "2 menit"],
    [180, "3 menit"],
    [600, "10 menit"],
    [1800, "30 menit"],
    [3540, "59 menit"],
    [3599, "3599 detik"],
    [3600, "1 jam"],
    [3601, "3601 detik"],
    [3660, "1 jam 1 menit"],
    [5400, "1 jam 30 menit"],
    [7200, "2 jam"],
    [7260, "2 jam 1 menit"],
    [86400, "24 jam"],
    [1.5, "1,5 detik"],
    [90.5, "90,5 detik"],
    [-1, "tidak sah"],
    [NaN, "tidak sah"],
    [Infinity, "tidak sah"],
    [-Infinity, "tidak sah"],
    [Number.MAX_SAFE_INTEGER + 2, "tidak sah"],
  ];
  for (const [seconds, text] of table) {
    test(`${seconds} -> ${text}`, () => {
      expect(formatSeconds(seconds)).toBe(text);
    });
  }

  test("tidak pernah membulatkan: setiap detik bulat dari 0 sampai 4000 bisa dibaca kembali", () => {
    for (let s = 0; s <= 4000; s += 1) {
      const text = formatSeconds(s);
      const hours = /(\d+) jam/.exec(text)?.[1];
      const minutes = /(\d+) menit/.exec(text)?.[1];
      const secs = /^(\d+) detik$/.exec(text)?.[1];
      const back = secs
        ? Number(secs)
        : Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60;
      expect(back, `${s} -> ${text}`).toBe(s);
      // Detik hanya muncul untuk yang tidak habis dibagi 60 (atau nol).
      expect(text.includes("detik")).toBe(s === 0 || s % 60 !== 0);
    }
  });
});

test.describe("perubahan dan perbandingan", () => {
  test("tanpa perubahan: daftar kosong, dan sameThresholds benar", () => {
    const a = defaultThresholds();
    const b = defaultThresholds();
    expect(changedThresholds(a, b)).toEqual([]);
    expect(sameThresholds(a, b)).toBe(true);
    expect(sameThresholds(a, withField("cpu", "threshold", 84))).toBe(false);
    expect(isDefaultThresholds(a)).toBe(true);
  });

  test("urutan stabil menurut aturan lalu kolom (ambang, lalu durasi)", () => {
    const saved = defaultThresholds();
    const draft = defaultThresholds();
    // Sengaja diubah dari urutan terbalik.
    draft.offline.forSeconds = 60;
    draft.optical.threshold = -27.5;
    draft.port.forSeconds = 120;
    draft.port.threshold = 40;
    draft.cpu.forSeconds = 300;
    draft.queue.threshold = 90;
    const changes = changedThresholds(saved, draft);
    expect(changes).toEqual([
      { kind: "queue", field: "threshold", from: 95, to: 90 },
      { kind: "cpu", field: "forSeconds", from: 180, to: 300 },
      { kind: "port", field: "threshold", from: 20, to: 40 },
      { kind: "port", field: "forSeconds", from: 60, to: 120 },
      { kind: "optical", field: "threshold", from: -25, to: -27.5 },
      { kind: "offline", field: "forSeconds", from: 30, to: 60 },
    ]);
    // Dibalik: dari dan ke bertukar, urutan tetap.
    expect(changedThresholds(draft, saved).map((c) => c.kind)).toEqual(
      changes.map((c) => c.kind),
    );
    expect(describeChange(changes[1])).toBe(
      "Beban router tinggi: durasi 3 menit menjadi 5 menit",
    );
    expect(describeChange(changes[0])).toBe(
      "Jalur traffic penuh: ambang 95% menjadi 90%",
    );
    expect(describeChange(changes[4])).toBe(
      "Sinyal optik lemah: ambang -25 dBm menjadi -27,5 dBm",
    );
  });

  test("mengubah satu kolom memberi tepat satu perubahan, untuk semua kolom yang bisa diubah", () => {
    const cases: Array<[IncidentKind, "threshold" | "forSeconds", number]> = [
      ["queue", "threshold", 60],
      ["queue", "forSeconds", 20],
      ["cpu", "threshold", 60],
      ["cpu", "forSeconds", 60],
      ["port", "threshold", 60],
      ["port", "forSeconds", 90],
      ["optical", "threshold", -30],
      ["offline", "forSeconds", 45],
    ];
    for (const [kind, field, value] of cases) {
      const draft = withField(kind, field, value);
      const changes = changedThresholds(defaultThresholds(), draft);
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ kind, field, to: value });
      expect(isDefaultThresholds(draft)).toBe(false);
    }
  });
});

test.describe("teks JSON untuk penyimpanan", () => {
  const defaults = defaultThresholds();

  test("sampah apa pun menghasilkan nilai sah dan tidak melempar galat", () => {
    const junk: Array<string | null | undefined> = [
      null,
      undefined,
      "",
      " ",
      "[]",
      "{}",
      "null",
      "true",
      "0",
      '"teks"',
      "[1,2,3]",
      "{",
      "}{",
      "tidak json",
      "{'cpu':1}",
      '{"cpu":null}',
      '{"cpu":"70"}',
      '{"cpu":[]}',
      '{"cpu":{}}',
      '{"cpu":{"threshold":"70","forSeconds":"60"}}',
      '{"cpu":{"threshold":NaN}}',
      '{"cpu":{"threshold":1e999,"forSeconds":1e999}}',
      '{"cpu":{"threshold":null,"forSeconds":180}}',
      '{"cpu":{"threshold":85}}',
      '{"cpu":{"forSeconds":180}}',
      '{"cpu":{"threshold":40,"forSeconds":180}}',
      '{"optical":{"threshold":-25,"forSeconds":5}}',
      '{"offline":{"threshold":50,"forSeconds":30}}',
      '{"__proto__":{"cpu":{"threshold":60,"forSeconds":60}}}',
      '{"constructor":{"cpu":{"threshold":60,"forSeconds":60}}}',
      '{"cpu":{"__proto__":{"threshold":60},"forSeconds":180}}',
    ];
    for (const raw of junk) {
      const result = parseThresholds(raw);
      expect(validateThresholds(result), String(raw)).toEqual({});
      expect(sameThresholds(result, defaults), String(raw)).toBe(true);
    }
  });

  test("aturan yang tidak sah diganti bawaan per aturan, sisanya dipakai", () => {
    const raw = JSON.stringify({
      queue: { threshold: 80, forSeconds: 20 },
      cpu: { threshold: 40, forSeconds: 120 },
      port: { threshold: 30, forSeconds: 29 },
      optical: { threshold: -28.5, forSeconds: 0 },
      offline: { threshold: null, forSeconds: 45 },
    });
    expect(parseThresholds(raw)).toEqual({
      queue: { threshold: 80, forSeconds: 20 },
      // cpu 40 di bawah batas, port 29 detik di bawah batas: seluruh aturan bawaan.
      cpu: { threshold: 85, forSeconds: 180 },
      port: { threshold: 20, forSeconds: 60 },
      optical: { threshold: -28.5, forSeconds: 0 },
      offline: { threshold: null, forSeconds: 45 },
    });
  });

  test("kolom hilang, kunci asing, dan kunci berbahaya", () => {
    const raw =
      '{"queue":{"threshold":80,"forSeconds":20,"tambahan":1},"asing":{"threshold":1},"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"cpu":{"threshold":70}}';
    const result = parseThresholds(raw);
    expect(result.queue).toEqual({ threshold: 80, forSeconds: 20 });
    // cpu kehilangan forSeconds: aturannya bawaan.
    expect(result.cpu).toEqual({ threshold: 85, forSeconds: 180 });
    expect(Object.keys(result)).toEqual([...ruleKinds]);
    expect(Object.keys(result.queue)).toEqual(["threshold", "forSeconds"]);
    expect(
      (result as unknown as Record<string, unknown>).asing,
    ).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    // Kunci seperti toString yang hanya warisan tidak dianggap isi.
    const inherited = parseThresholds('{"toString":{"threshold":1}}');
    expect(sameThresholds(inherited, defaults)).toBe(true);
  });

  test("balik-pergi serialize dan parse, dan serialize hanya menulis lima aturan", () => {
    const custom = defaultThresholds();
    custom.queue.threshold = 80;
    custom.cpu.forSeconds = 300;
    custom.port.threshold = 250;
    custom.optical.threshold = -30.5;
    custom.offline.forSeconds = 3600;
    const raw = serializeThresholds(custom);
    expect(parseThresholds(raw)).toEqual(custom);
    expect(parseThresholds(serializeThresholds(defaults))).toEqual(defaults);
    expect(Object.keys(JSON.parse(raw))).toEqual([...ruleKinds]);
    expect(JSON.parse(raw).offline.threshold).toBeNull();
    // Kunci asing pada objek masukan tidak ikut ditulis.
    const extra = {
      ...custom,
      asing: { threshold: 1, forSeconds: 1 },
    } as unknown as ThresholdValues;
    expect(Object.keys(JSON.parse(serializeThresholds(extra)))).toEqual([
      ...ruleKinds,
    ]);
    // Teks yang sudah ditulis dibaca sama berulang kali.
    expect(serializeThresholds(parseThresholds(raw))).toBe(raw);
  });

  test("hasil parse bukan objek bersama: mengubahnya tidak memengaruhi pembacaan berikutnya", () => {
    const first = parseThresholds(null);
    first.cpu.threshold = 1;
    expect(parseThresholds(null).cpu.threshold).toBe(85);
  });
});

test.describe("validateThresholds melawan implementasi referensi (acak, seed tetap)", () => {
  // Referensi independen, ditulis ulang dari ketentuan task: batas tiap kolom
  // dan nilai tetapnya, dengan aritmetika bilangan bulat (tanpa toleransi).
  type Spec = { min: number; max: number; step: number } | { fixed: unknown };
  const spec: Record<IncidentKind, { t: Spec; s: Spec }> = {
    queue: {
      t: { min: 50, max: 99, step: 1 },
      s: { min: 10, max: 600, step: 1 },
    },
    cpu: {
      t: { min: 50, max: 99, step: 1 },
      s: { min: 30, max: 1800, step: 1 },
    },
    port: {
      t: { min: 1, max: 1000, step: 1 },
      s: { min: 30, max: 600, step: 1 },
    },
    optical: { t: { min: -40, max: -15, step: 0.5 }, s: { fixed: 0 } },
    offline: { t: { fixed: null }, s: { min: 10, max: 3600, step: 1 } },
  };
  const referenceValid = (value: unknown, rule: Spec) => {
    if ("fixed" in rule) return value === rule.fixed;
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (value < rule.min || value > rule.max) return false;
    // Langkah 1 dan 0,5: dikali dua lalu diuji bilangan bulat.
    const doubled = (value - rule.min) * 2;
    return rule.step === 1
      ? Number.isInteger(value - rule.min)
      : Number.isInteger(doubled);
  };

  test("3000 isian acak: kolom yang ditandai persis kolom yang tidak sah", () => {
    const random = mulberry32(7);
    const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
    const specials: unknown[] = [
      NaN,
      Infinity,
      -Infinity,
      null,
      undefined,
      "70",
      "",
      true,
      -0,
      0,
      [],
    ];
    const randomValue = (): unknown => {
      const roll = random();
      if (roll < 0.15) return pick(specials);
      if (roll < 0.45) return Math.floor(random() * 2200) - 100;
      if (roll < 0.7) return (Math.floor(random() * 4400) - 200) / 2;
      if (roll < 0.85) return Math.round((random() * 4000 - 100) * 100) / 100;
      return Math.floor(random() * 8) - 45 + 0.5 * Math.floor(random() * 3);
    };
    let invalidCount = 0;
    let validCount = 0;
    for (let n = 0; n < 3000; n += 1) {
      const values = defaultThresholds();
      const expected: Record<string, string[]> = {};
      for (const kind of KINDS) {
        // Sebagian besar dimulai dari yang sah, supaya cabang sah ikut teruji.
        const entry = values[kind] as unknown as Record<string, unknown>;
        for (const [field, rule] of [
          ["threshold", spec[kind].t],
          ["forSeconds", spec[kind].s],
        ] as const) {
          if (random() < 0.5) entry[field] = randomValue();
          if (!referenceValid(entry[field], rule)) {
            (expected[kind] ??= []).push(field);
            invalidCount += 1;
          } else {
            validCount += 1;
          }
        }
      }
      const errors = validateThresholds(values);
      const actual: Record<string, string[]> = {};
      for (const kind of KINDS) {
        const fields = Object.keys(errors[kind] ?? {});
        if (fields.length > 0) actual[kind] = fields;
      }
      expect(actual, `isian ${n}: ${JSON.stringify(values)}`).toEqual(expected);
    }
    // Kedua cabang terwakili dalam jumlah besar.
    expect(invalidCount).toBeGreaterThan(1500);
    expect(validCount).toBeGreaterThan(5000);
  });

  test("aturan yang sah tidak pernah mengubah hasil parse dan serialize", () => {
    const random = mulberry32(99);
    for (let n = 0; n < 500; n += 1) {
      const values = defaultThresholds();
      values.queue.threshold = 50 + Math.floor(random() * 50);
      values.queue.forSeconds = 10 + Math.floor(random() * 591);
      values.cpu.threshold = 50 + Math.floor(random() * 50);
      values.cpu.forSeconds = 30 + Math.floor(random() * 1771);
      values.port.threshold = 1 + Math.floor(random() * 1000);
      values.port.forSeconds = 30 + Math.floor(random() * 571);
      values.optical.threshold = -40 + 0.5 * Math.floor(random() * 51);
      values.offline.forSeconds = 10 + Math.floor(random() * 3591);
      expect(validateThresholds(values)).toEqual({});
      expect(parseThresholds(serializeThresholds(values))).toEqual(values);
    }
  });
});

test.describe("registry (penyimpanan tiruan)", () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    };
  }
  function makeRegistry(storage = fakeStorage()) {
    let handler: (() => void) | null = null;
    let listens = 0;
    let stops = 0;
    const registry = createThresholdRegistry({
      storage: () => storage,
      listen: (onChange) => {
        handler = onChange;
        listens += 1;
        return () => {
          handler = null;
          stops += 1;
        };
      },
    });
    return {
      registry,
      storage,
      fire: () => handler?.(),
      counts: () => ({ listens, stops }),
    };
  }
  const custom = () => {
    const values = defaultThresholds();
    values.cpu.threshold = 70;
    values.cpu.forSeconds = 300;
    return values;
  };

  test("kosong: bawaan, dan objek yang sama dikembalikan terus", () => {
    const { registry } = makeRegistry();
    const first = registry.getSnapshot();
    expect(first).toEqual(defaultThresholds());
    expect(registry.getSnapshot()).toBe(first);
    expect(registry.getSaved()).toBe(first);
    const server = registry.getServerSnapshot();
    expect(server).toEqual(defaultThresholds());
    expect(registry.getServerSnapshot()).toBe(server);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.cpu)).toBe(true);
  });

  test("snapshot server selalu bawaan, juga bila sudah ada yang tersimpan", () => {
    const { registry } = makeRegistry();
    registry.save(custom());
    expect(registry.getServerSnapshot()).toEqual(defaultThresholds());
    expect(registry.getSnapshot().cpu.threshold).toBe(70);
  });

  test("simpan nilai sah: tertulis, snapshot berganti, pelanggan diberi tahu", () => {
    const { registry, storage } = makeRegistry();
    let notified = 0;
    registry.subscribe(() => {
      notified += 1;
    });
    const before = registry.getSnapshot();
    const values = custom();
    const result = registry.save(values);
    expect(result).toEqual({ ok: true, persisted: true });
    expect(notified).toBe(1);
    const after = registry.getSnapshot();
    expect(after).not.toBe(before);
    expect(after).toEqual(values);
    expect(registry.getSnapshot()).toBe(after);
    expect(parseThresholds(storage.data.get(THRESHOLDS_STORAGE_KEY))).toEqual(
      values,
    );
    expect(THRESHOLDS_STORAGE_KEY).toBe("alertThresholds");
    // Mengubah argumen sesudah menyimpan tidak mengubah yang tersimpan.
    values.cpu.threshold = 99;
    expect(registry.getSnapshot().cpu.threshold).toBe(70);
  });

  test("simpan nilai yang sama tidak mengganti objek snapshot", () => {
    const { registry } = makeRegistry();
    registry.save(custom());
    const snapshot = registry.getSnapshot();
    registry.save(custom());
    expect(registry.getSnapshot()).toBe(snapshot);
  });

  test("simpan nilai tidak sah: ditolak seluruhnya, tidak ada yang berubah", () => {
    const { registry, storage } = makeRegistry();
    let notified = 0;
    registry.subscribe(() => {
      notified += 1;
    });
    const before = registry.getSnapshot();
    const values = custom();
    values.queue.threshold = 49;
    values.optical.forSeconds = 5;
    const result = registry.save(values);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors)).toEqual(["queue", "optical"]);
    }
    expect(notified).toBe(0);
    expect(registry.getSnapshot()).toBe(before);
    expect(storage.data.has(THRESHOLDS_STORAGE_KEY)).toBe(false);
  });

  test("reset: kunci dihapus, kembali bawaan, pelanggan diberi tahu", () => {
    const { registry, storage } = makeRegistry();
    registry.save(custom());
    let notified = 0;
    registry.subscribe(() => {
      notified += 1;
    });
    expect(registry.reset()).toEqual({ ok: true, persisted: true });
    expect(storage.data.has(THRESHOLDS_STORAGE_KEY)).toBe(false);
    expect(registry.getSnapshot()).toEqual(defaultThresholds());
    expect(notified).toBe(1);
  });

  test("tab lain menyimpan: pelanggan diberi tahu dan nilainya ikut", () => {
    const { registry, storage, fire } = makeRegistry();
    let notified = 0;
    registry.subscribe(() => {
      notified += 1;
    });
    const before = registry.getSnapshot();
    storage.data.set(THRESHOLDS_STORAGE_KEY, serializeThresholds(custom()));
    fire();
    expect(notified).toBe(1);
    expect(registry.getSnapshot()).toEqual(custom());
    expect(registry.getSnapshot()).not.toBe(before);
  });

  test("teks berubah tetapi isinya sama: objek snapshot tetap", () => {
    const { registry, storage } = makeRegistry();
    registry.save(custom());
    const snapshot = registry.getSnapshot();
    // Urutan kunci dan spasi berbeda, nilainya sama.
    storage.data.set(
      THRESHOLDS_STORAGE_KEY,
      JSON.stringify(JSON.parse(serializeThresholds(custom())), null, 2),
    );
    expect(registry.getSnapshot()).toBe(snapshot);
  });

  test("isi rusak: bawaan tanpa galat; sebagian rusak: yang sah dipakai", () => {
    for (const raw of ["{", "[]", "null", '{"cpu":"x"}', "\u0000"]) {
      const { registry } = makeRegistry(
        fakeStorage({ [THRESHOLDS_STORAGE_KEY]: raw }),
      );
      expect(registry.getSnapshot()).toEqual(defaultThresholds());
    }
    const partial = makeRegistry(
      fakeStorage({
        [THRESHOLDS_STORAGE_KEY]: JSON.stringify({
          queue: { threshold: 80, forSeconds: 20 },
          cpu: { threshold: 1, forSeconds: 1 },
        }),
      }),
    );
    const snapshot = partial.registry.getSnapshot();
    expect(snapshot.queue).toEqual({ threshold: 80, forSeconds: 20 });
    expect(snapshot.cpu).toEqual({ threshold: 85, forSeconds: 180 });
    // Menyimpan di atas isi rusak menulis teks yang bersih.
    partial.registry.save(custom());
    expect(
      JSON.parse(partial.storage.data.get(THRESHOLDS_STORAGE_KEY)!).cpu,
    ).toEqual({ threshold: 70, forSeconds: 300 });
  });

  test("penyimpanan tidak ada: nilai di sesi ini saja, tidak ada galat", () => {
    const registry = createThresholdRegistry({
      storage: () => null,
      listen: () => () => {},
    });
    expect(registry.getSnapshot()).toEqual(defaultThresholds());
    let notified = 0;
    registry.subscribe(() => {
      notified += 1;
    });
    expect(registry.save(custom())).toEqual({ ok: true, persisted: false });
    expect(notified).toBe(1);
    expect(registry.getSnapshot()).toEqual(custom());
    expect(registry.reset()).toEqual({ ok: true, persisted: false });
    expect(registry.getSnapshot()).toEqual(defaultThresholds());
  });

  test("membaca melempar galat (diblokir): bawaan dan tetap bisa menyimpan di memori", () => {
    const registry = createThresholdRegistry({
      storage: () => ({
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("SecurityError");
        },
        removeItem: () => {
          throw new Error("SecurityError");
        },
      }),
      listen: () => () => {},
    });
    expect(registry.getSnapshot()).toEqual(defaultThresholds());
    expect(registry.save(custom())).toEqual({ ok: true, persisted: false });
    expect(registry.getSnapshot()).toEqual(custom());
  });

  test("menulis melempar galat (penuh): nilai tetap berlaku di sesi ini", () => {
    const data = new Map<string, string>();
    const registry = createThresholdRegistry({
      storage: () => ({
        getItem: (key) => data.get(key) ?? null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {},
      }),
      listen: () => () => {},
    });
    expect(registry.save(custom())).toEqual({ ok: true, persisted: false });
    expect(registry.getSnapshot()).toEqual(custom());
    // Sesudah gagal sekali, tidak ada percobaan menulis lagi dan tidak ada galat.
    expect(registry.save(defaultThresholds())).toEqual({
      ok: true,
      persisted: false,
    });
    expect(registry.getSnapshot()).toEqual(defaultThresholds());
  });

  test("mendengarkan tab lain hanya selama ada pelanggan", () => {
    const { registry, counts } = makeRegistry();
    const stopA = registry.subscribe(() => {});
    const stopB = registry.subscribe(() => {});
    expect(counts()).toEqual({ listens: 1, stops: 0 });
    stopA();
    expect(counts()).toEqual({ listens: 1, stops: 0 });
    stopB();
    expect(counts()).toEqual({ listens: 1, stops: 1 });
    registry.subscribe(() => {});
    expect(counts()).toEqual({ listens: 2, stops: 1 });
  });

  test("tidak menyimpan rahasia: hanya lima aturan dan dua angkanya", () => {
    const { registry, storage } = makeRegistry();
    registry.save(custom());
    const stored = JSON.parse(storage.data.get(THRESHOLDS_STORAGE_KEY)!);
    expect(Object.keys(stored)).toEqual([...ruleKinds]);
    for (const entry of Object.values(stored) as object[]) {
      expect(Object.keys(entry)).toEqual(["threshold", "forSeconds"]);
    }
  });
});
