import { anomalyRules } from "./anomalies";
import { incidentLabels } from "./incidents";
import type { IncidentKind } from "./types";

// AMBANG ALERT YANG BISA DIATUR. Logika murni (tanpa React, tanpa window) di balik
// halaman Pengaturan > Ambang Batas: nilai per aturan, batas yang boleh,
// validasi, kalimat penjelas, dan baca/tulis teks JSON untuk penyimpanan.
//
// Sumber kebenaran nilai bawaan adalah `anomalyRules` (anomalies.ts), yang harus
// cocok dengan rule engine Go (backend/internal/engine/rules.go). Di sini TIDAK
// ada angka bawaan kedua: `defaultThresholds` membacanya dari sana. Yang dimiliki
// berkas ini hanya batas yang boleh dipilih (`thresholdLimits`).
//
// Fase frontend: nilai yang diubah hanya disimpan di peramban
// (threshold-registry.ts) dan BELUM dibaca rule engine. Saat backend siap, nilai
// yang sama dikirim lewat API dan rule engine membacanya dari tabel pengaturan.

export type ThresholdField = "threshold" | "forSeconds";

// Dua angka yang bisa diatur untuk satu aturan. `threshold` kosong (null) pada
// aturan tanpa ambang angka (pelanggan offline: yang dinilai hanya lamanya).
export interface RuleValues {
  threshold: number | null;
  forSeconds: number;
}

export type ThresholdValues = Record<IncidentKind, RuleValues>;

// Urutan jenis aturan yang tetap: sama dengan anomalyRules, dipakai di semua
// daftar, perubahan, dan kartu supaya hasilnya stabil.
export const ruleKinds: readonly IncidentKind[] = Object.freeze(
  anomalyRules.map((rule) => rule.kind),
);

export const thresholdFields: readonly ThresholdField[] = Object.freeze([
  "threshold",
  "forSeconds",
] as const);

// ---------------------------------------------------------------------------
// Batas yang boleh dipilih
// ---------------------------------------------------------------------------

export interface FieldLimit {
  min: number;
  max: number;
  // Nilai harus berjarak kelipatan `step` dari `min`.
  step: number;
  // Salah bila kolom ini tetap pada nilai bawaan dan tidak boleh diubah.
  editable: boolean;
}

export interface RuleLimit {
  // above: alert bila nilai terukur DI ATAS ambang. below: DI BAWAH ambang
  // (hanya redaman optik, karena makin negatif makin lemah).
  direction: "above" | "below";
  // Satuan ambang: "%", "error/menit", "dBm"; kosong bila tidak ada ambang.
  unit: string;
  // null: aturan ini tidak punya ambang angka.
  threshold: FieldLimit | null;
  // Berapa detik kondisi harus bertahan sebelum menjadi alert; selalu bilangan
  // bulat detik.
  forSeconds: FieldLimit;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

export const thresholdLimits: Readonly<Record<IncidentKind, RuleLimit>> =
  deepFreeze({
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
      // Alert langsung, tanpa jeda: durasinya tetap 0 dan tidak bisa diubah.
      forSeconds: { min: 0, max: 0, step: 1, editable: false },
    },
    offline: {
      direction: "above",
      unit: "",
      threshold: null,
      forSeconds: { min: 10, max: 3600, step: 1, editable: true },
    },
  });

// Nilai bawaan, DIAMBIL dari anomalyRules. Salinan baru setiap dipanggil, supaya
// pemanggil bebas mengubahnya tanpa merusak objek bersama.
export function defaultThresholds(): ThresholdValues {
  const values = {} as ThresholdValues;
  for (const rule of anomalyRules) {
    values[rule.kind] = {
      threshold: rule.threshold,
      forSeconds: rule.forSeconds,
    };
  }
  return values;
}

export function cloneThresholds(values: ThresholdValues): ThresholdValues {
  const copy = {} as ThresholdValues;
  for (const kind of ruleKinds) {
    copy[kind] = {
      threshold: values[kind].threshold,
      forSeconds: values[kind].forSeconds,
    };
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Format angka dan durasi
// ---------------------------------------------------------------------------

// Angka dengan koma desimal Indonesia dan tanpa pemisah ribuan: 85, -25,5.
// Sengaja tidak memakai Intl: pemisah ribuan ("1.000") justru yang ditolak
// parseNumberInput, jadi teks yang ditampilkan harus bisa diketik kembali.
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return String(value === 0 ? 0 : value).replace(".", ",");
}

// Durasi dari detik, TANPA membulatkan diam-diam. Aturannya:
//  - bukan bilangan bulat: ditulis apa adanya dalam detik ("1,5 detik");
//  - tidak habis dibagi 60: tetap dalam detik ("90 detik", "3601 detik"), karena
//    "1 menit 30 detik" menambah angka yang harus dibaca ulang;
//  - habis dibagi 60: menit ("3 menit"), dan jam bila sampai 60 menit
//    ("1 jam", "1 jam 30 menit").
// Bukan angka, tak hingga, atau negatif ditulis "tidak sah".
export function formatSeconds(seconds: number): string {
  if (
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    seconds > Number.MAX_SAFE_INTEGER
  ) {
    return "tidak sah";
  }
  if (!Number.isInteger(seconds)) return `${formatNumber(seconds)} detik`;
  if (seconds === 0 || seconds % 60 !== 0) return `${seconds} detik`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} jam` : `${hours} jam ${rest} menit`;
}

function unitSuffix(unit: string) {
  if (unit === "") return "";
  return unit === "%" ? "%" : ` ${unit}`;
}

// Satu nilai dengan satuannya, untuk hint, perubahan, dan pesan galat.
export function formatValue(
  kind: IncidentKind,
  field: ThresholdField,
  value: number | null,
): string {
  if (value === null) return "tanpa ambang";
  if (field === "forSeconds") return formatSeconds(value);
  return `${formatNumber(value)}${unitSuffix(thresholdLimits[kind].unit)}`;
}

// ---------------------------------------------------------------------------
// Mengurai isian form
// ---------------------------------------------------------------------------

export type ParsedNumber =
  { ok: true; value: number } | { ok: false; error: string };

// "1.000", "12,345", "1.000.000": satu sampai tiga angka lalu kelompok tiga
// angka. Dalam tulisan Indonesia ini ribuan, dalam tulisan lain desimal, jadi
// tidak pernah ditebak, selalu ditolak.
const GROUPED = /^-?[1-9][0-9]{0,2}([.,][0-9]{3})+$/;
const PLAIN = /^-?[0-9]+([.,][0-9]+)?$/;

// Aturan teks isian, tegas dan sama untuk semua kolom:
//  - spasi di tepi dibuang; sisanya kosong berarti galat;
//  - hanya digit ASCII 0-9, satu tanda minus "-" di depan (bukan minus Unicode),
//    dan satu pemisah desimal, koma atau titik ("85,5" dan "85.5" sama);
//  - tanpa notasi ilmiah ("1e2"), heksadesimal ("0x10"), tanda plus, spasi di
//    tengah, digit huruf lain ("٨٥"), Infinity/NaN, atau sisa huruf ("85abc");
//  - pola ribuan ("1.000") ditolak, bukan ditebak;
//  - nol di depan boleh ("007" = 7) dan "-0" menjadi 0.
export function parseNumberInput(text: string): ParsedNumber {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed === "") return { ok: false, error: "Isian tidak boleh kosong." };
  if (GROUPED.test(trimmed)) {
    return {
      ok: false,
      error: "Tulis tanpa pemisah ribuan, misalnya 1000.",
    };
  }
  if (!PLAIN.test(trimmed)) {
    return {
      ok: false,
      error: "Isi dengan angka biasa, misalnya 85 atau -25,5.",
    };
  }
  const value = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(value)) {
    return { ok: false, error: "Angka terlalu besar." };
  }
  return { ok: true, value: value === 0 ? 0 : value };
}

// ---------------------------------------------------------------------------
// Validasi
// ---------------------------------------------------------------------------

export type RuleErrors = Partial<Record<ThresholdField, string>>;
export type ThresholdErrors = Partial<Record<IncidentKind, RuleErrors>>;

const defaultValue = (kind: IncidentKind, field: ThresholdField) => {
  const rule = anomalyRules.find((candidate) => candidate.kind === kind)!;
  return rule[field];
};

// Selisih dari `min` harus kelipatan bulat `step`; toleransi kecil menutup galat
// pembulatan pecahan biner.
function onStep(value: number, limit: FieldLimit) {
  const steps = (value - limit.min) / limit.step;
  return Math.abs(steps - Math.round(steps)) <= 1e-9;
}

function limitUnit(kind: IncidentKind, field: ThresholdField) {
  return field === "forSeconds"
    ? " detik"
    : unitSuffix(thresholdLimits[kind].unit);
}

// Pesan galat satu kolom, atau null bila nilainya sah. `value` sengaja unknown:
// isi penyimpanan dan form tidak bisa dipercaya bertipe benar.
function fieldError(
  kind: IncidentKind,
  field: ThresholdField,
  value: unknown,
): string | null {
  const limit = thresholdLimits[kind];
  const fieldLimit = field === "threshold" ? limit.threshold : limit.forSeconds;
  const fixed = defaultValue(kind, field);

  if (fieldLimit === null) {
    return value === null ? null : "Aturan ini tidak punya ambang angka.";
  }
  if (!fieldLimit.editable) {
    return value === fixed
      ? null
      : `Nilai ini tetap ${formatValue(kind, field, fixed)} dan tidak bisa diubah.`;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Isi dengan angka.";
  }
  const suffix = limitUnit(kind, field);
  if (value < fieldLimit.min || value > fieldLimit.max) {
    return `Harus antara ${formatNumber(fieldLimit.min)}${suffix} dan ${formatNumber(fieldLimit.max)}${suffix}.`;
  }
  if (!onStep(value, fieldLimit)) {
    return fieldLimit.step === 1
      ? "Harus bilangan bulat."
      : `Harus kelipatan ${formatNumber(fieldLimit.step)}${suffix}.`;
  }
  return null;
}

// Galat dua kolom satu aturan; objek kosong bila keduanya sah.
export function validateRule(kind: IncidentKind, entry: unknown): RuleErrors {
  const source =
    typeof entry === "object" && entry !== null
      ? (entry as Record<string, unknown>)
      : {};
  const errors: RuleErrors = {};
  for (const field of thresholdFields) {
    const message = fieldError(kind, field, source[field]);
    if (message !== null) errors[field] = message;
  }
  return errors;
}

// Galat seluruh aturan, per aturan per kolom. Objek kosong bila semuanya sah.
export function validateThresholds(values: ThresholdValues): ThresholdErrors {
  const errors: ThresholdErrors = {};
  const source = values as unknown as Record<string, unknown> | null;
  for (const kind of ruleKinds) {
    const ruleErrors = validateRule(
      kind,
      source !== null && typeof source === "object" ? source[kind] : undefined,
    );
    if (Object.keys(ruleErrors).length > 0) errors[kind] = ruleErrors;
  }
  return errors;
}

export function countThresholdErrors(errors: ThresholdErrors): number {
  let count = 0;
  for (const kind of ruleKinds) {
    count += Object.keys(errors[kind] ?? {}).length;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Isian form (teks) <-> nilai
// ---------------------------------------------------------------------------

export type ThresholdTexts = Record<
  IncidentKind,
  Record<ThresholdField, string>
>;

// Teks isian yang sesuai nilai: koma desimal, kosong untuk ambang yang tidak ada.
export function textsFromValues(values: ThresholdValues): ThresholdTexts {
  const texts = {} as ThresholdTexts;
  for (const kind of ruleKinds) {
    const { threshold, forSeconds } = values[kind];
    texts[kind] = {
      threshold: threshold === null ? "" : formatNumber(threshold),
      forSeconds: formatNumber(forSeconds),
    };
  }
  return texts;
}

export interface TextEvaluation {
  // Selalu sah: kolom yang isiannya salah memakai nilai dari `fallback`, dan
  // kolom yang tetap memakai nilai bawaan.
  values: ThresholdValues;
  // Galat per kolom: isiannya bukan angka, atau angkanya di luar batas.
  errors: ThresholdErrors;
}

function assignField(
  rule: RuleValues,
  field: ThresholdField,
  value: number | null,
) {
  if (field === "threshold") rule.threshold = value;
  else if (value !== null) rule.forSeconds = value;
}

// Menilai seluruh isian form. Isian kolom yang tidak bisa diubah diabaikan.
export function evaluateTexts(
  texts: ThresholdTexts,
  fallback: ThresholdValues,
): TextEvaluation {
  const values = cloneThresholds(fallback);
  const errors: ThresholdErrors = {};
  for (const kind of ruleKinds) {
    const limit = thresholdLimits[kind];
    for (const field of thresholdFields) {
      const fieldLimit =
        field === "threshold" ? limit.threshold : limit.forSeconds;
      if (fieldLimit === null || !fieldLimit.editable) {
        // Tetap pada bawaan, apa pun isiannya.
        assignField(values[kind], field, defaultValue(kind, field));
        continue;
      }
      const parsed = parseNumberInput(texts[kind][field]);
      if (!parsed.ok) {
        errors[kind] = { ...errors[kind], [field]: parsed.error };
        continue;
      }
      const message = fieldError(kind, field, parsed.value);
      if (message !== null) {
        errors[kind] = { ...errors[kind], [field]: message };
      } else {
        assignField(values[kind], field, parsed.value);
      }
    }
  }
  return { values, errors };
}

// ---------------------------------------------------------------------------
// Kalimat penjelas
// ---------------------------------------------------------------------------

function thresholdText(value: number | null) {
  return value === null ? "-" : formatNumber(value);
}

// Aturan dalam satu kalimat, dari nilai. Dengan nilai bawaan maknanya sama dengan
// `anomalyRules[].description`; aturan port ditambah lamanya ("selama 1 menit")
// karena description-nya tidak menyebutnya padahal forSeconds-nya 60.
export function describeRule(kind: IncidentKind, values: RuleValues): string {
  const lasting =
    values.forSeconds > 0 ? ` selama ${formatSeconds(values.forSeconds)}` : "";
  const limit = thresholdText(values.threshold);
  switch (kind) {
    case "queue":
      return `Pemakaian antrean di atas ${limit}%${lasting}`;
    case "cpu":
      return `CPU router di atas ${limit}%${lasting}`;
    case "port":
      return `Error interface naik lebih dari ${limit} per menit${lasting}`;
    case "optical":
      return `Rx ONU di bawah ${limit} dBm${lasting} (bukan CCQ)`;
    case "offline":
      return `Pelanggan terputus lebih dari ${formatSeconds(values.forSeconds)}`;
  }
}

// Arah alert dalam satu kalimat; kosong bila aturan tidak punya ambang.
export function describeDirection(kind: IncidentKind): string | null {
  const limit = thresholdLimits[kind];
  if (limit.threshold === null) return null;
  return limit.direction === "above"
    ? "Alert muncul bila nilai di atas ambang."
    : "Alert muncul bila nilai di bawah ambang (makin negatif makin lemah).";
}

// Rentang yang boleh satu kolom, untuk hint di bawah isian.
export function describeLimit(
  kind: IncidentKind,
  field: ThresholdField,
): string {
  const limit = thresholdLimits[kind];
  const fieldLimit = field === "threshold" ? limit.threshold : limit.forSeconds;
  if (fieldLimit === null) return "Tidak ada ambang angka.";
  if (!fieldLimit.editable) return "Tetap, tidak bisa diubah.";
  const suffix = limitUnit(kind, field);
  const steps =
    fieldLimit.step === 1
      ? "bilangan bulat"
      : `kelipatan ${formatNumber(fieldLimit.step)}`;
  return `Rentang ${formatNumber(fieldLimit.min)}${suffix} sampai ${formatNumber(fieldLimit.max)}${suffix}, ${steps}.`;
}

// ---------------------------------------------------------------------------
// Perbandingan
// ---------------------------------------------------------------------------

export function sameThresholds(a: ThresholdValues, b: ThresholdValues) {
  return ruleKinds.every(
    (kind) =>
      a[kind].threshold === b[kind].threshold &&
      a[kind].forSeconds === b[kind].forSeconds,
  );
}

export function isDefaultThresholds(values: ThresholdValues) {
  return sameThresholds(values, defaultThresholds());
}

export interface ThresholdChange {
  kind: IncidentKind;
  field: ThresholdField;
  from: number | null;
  to: number | null;
}

// Kolom yang nilainya berbeda, urut menurut aturan lalu kolom (ambang, lalu
// durasi). Kosong bila tidak ada yang berubah. Bahan untuk jejak aktivitas.
export function changedThresholds(
  saved: ThresholdValues,
  draft: ThresholdValues,
): ThresholdChange[] {
  const changes: ThresholdChange[] = [];
  for (const kind of ruleKinds) {
    for (const field of thresholdFields) {
      const from = saved[kind][field];
      const to = draft[kind][field];
      if (from !== to) changes.push({ kind, field, from, to });
    }
  }
  return changes;
}

// Satu perubahan dalam satu baris: "Beban router tinggi: ambang 85% menjadi 70%".
export function describeChange(change: ThresholdChange): string {
  const name = change.field === "threshold" ? "ambang" : "durasi";
  return `${incidentLabels[change.kind]}: ${name} ${formatValue(change.kind, change.field, change.from)} menjadi ${formatValue(change.kind, change.field, change.to)}`;
}

// ---------------------------------------------------------------------------
// Teks JSON untuk penyimpanan
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ownValue = (source: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(source, key) ? source[key] : undefined;

// Membaca isi penyimpanan. Tidak pernah melempar galat. Isi yang rusak atau
// diubah tangan tidak boleh merobohkan halaman: aturan yang tidak sah diganti
// nilai bawaannya (per aturan), sisanya dipakai. Hasilnya dibangun dari nol dari
// daftar aturan yang dikenal, jadi kunci asing dibuang dan kunci seperti
// __proto__ atau constructor tidak punya jalan masuk.
export function parseThresholds(
  raw: string | null | undefined,
): ThresholdValues {
  const result = defaultThresholds();
  if (typeof raw !== "string" || raw === "") return result;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return result;
  }
  if (!isPlainObject(data)) return result;
  for (const kind of ruleKinds) {
    const entry = ownValue(data, kind);
    if (!isPlainObject(entry)) continue;
    const candidate = {
      threshold: ownValue(entry, "threshold"),
      forSeconds: ownValue(entry, "forSeconds"),
    };
    if (Object.keys(validateRule(kind, candidate)).length === 0) {
      result[kind] = {
        threshold: candidate.threshold as number | null,
        forSeconds: candidate.forSeconds as number,
      };
    }
  }
  return result;
}

// Teks JSON dari nilai: hanya lima aturan dan dua kolomnya, urut menurut aturan.
export function serializeThresholds(values: ThresholdValues): string {
  const data: Record<string, RuleValues> = {};
  for (const kind of ruleKinds) {
    data[kind] = {
      threshold: values[kind].threshold,
      forSeconds: values[kind].forSeconds,
    };
  }
  return JSON.stringify(data);
}
