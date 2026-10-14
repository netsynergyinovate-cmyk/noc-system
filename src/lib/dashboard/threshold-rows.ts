import {
  cloneThresholds,
  defaultThresholds,
  ruleKinds,
  validateThresholds,
  type ThresholdValues,
} from "./thresholds";
import type { IncidentKind } from "./types";

export interface ThresholdRow {
  ruleKind: IncidentKind;
  threshold: number | null;
  forSeconds: number;
}

// Bawaan ditimpa baris database. Baris asing atau tak sah diabaikan (aturan itu
// tetap bawaan), jadi data rusak tidak merobohkan pembacaan.
export function applyRows(rows: readonly ThresholdRow[]): ThresholdValues {
  const result = defaultThresholds();
  for (const row of rows) {
    if (!ruleKinds.includes(row.ruleKind)) continue;
    const candidate = { threshold: row.threshold, forSeconds: row.forSeconds };
    const probe = { ...result, [row.ruleKind]: candidate } as ThresholdValues;
    if (validateThresholds(probe)[row.ruleKind]) continue;
    result[row.ruleKind] = candidate;
  }
  return result;
}

// Gabung perubahan sebagian ke nilai sekarang; hanya kunci yang dikenal.
export function mergeThresholds(
  current: ThresholdValues,
  patch: Partial<ThresholdValues>,
): ThresholdValues {
  const merged = cloneThresholds(current);
  for (const kind of ruleKinds) {
    const entry = Object.hasOwn(patch, kind) ? patch[kind] : undefined;
    if (entry) merged[kind] = { threshold: entry.threshold, forSeconds: entry.forSeconds };
  }
  return merged;
}

// Satu baris upsert per aturan.
export function toRows(values: ThresholdValues): ThresholdRow[] {
  return ruleKinds.map((ruleKind) => ({
    ruleKind,
    threshold: values[ruleKind].threshold,
    forSeconds: values[ruleKind].forSeconds,
  }));
}
