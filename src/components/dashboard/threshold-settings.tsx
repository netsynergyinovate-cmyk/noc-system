"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleDot,
  Pencil,
  RotateCcw,
  Save,
  Undo2,
  Zap,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useCanDo } from "@/components/access";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { incidentLabels } from "@/lib/dashboard/incidents";
import {
  getThresholdsServerSnapshot,
  getThresholdsSnapshot,
  resetSavedThresholds,
  saveThresholds,
  subscribeThresholds,
  thresholdRegistry,
} from "@/lib/dashboard/threshold-registry";
import {
  changedThresholds,
  countThresholdErrors,
  defaultThresholds,
  describeChange,
  describeDirection,
  describeLimit,
  describeRule,
  evaluateTexts,
  formatSeconds,
  formatValue,
  isDefaultThresholds,
  ruleKinds,
  textsFromValues,
  thresholdFields,
  thresholdLimits,
  type RuleErrors,
  type RuleValues,
  type ThresholdChange,
  type ThresholdField,
  type ThresholdTexts,
} from "@/lib/dashboard/thresholds";
import type { IncidentKind } from "@/lib/dashboard/types";

// HALAMAN AMBANG ALERT (Pengaturan > Ambang Batas). Satu kartu per aturan deteksi
// (lima, sama dengan `anomalyRules`). Isian disimpan sebagai TEKS sementara
// diketik (draft), diperiksa di setiap render oleh `evaluateTexts`, dan baru
// menjadi angka tersimpan lewat "Simpan ambang".
//
// Draft hanya berisi kolom yang diubah pengguna ("edits"); kolom yang tidak
// disentuh selalu menampilkan nilai tersimpan. Karena itu nilai tersimpan tidak
// pernah disalin ke state lewat efek: ia dibaca dengan useSyncExternalStore dari
// threshold-registry.ts (tabel alert_thresholds lewat /api/thresholds).
//
// Server dan render pertama di browser memakai nilai bawaan (getServerSnapshot),
// nilai dari database masuk sesudah dimuat. Menyimpan diblokir sampai nilai
// database termuat, supaya isian bawaan tidak menimpa ambang yang sudah ada.

// Kolom yang diubah pengguna saja, sebagai teks.
type Edits = Partial<
  Record<IncidentKind, Partial<Record<ThresholdField, string>>>
>;

type Notice =
  | { kind: "saved" | "reset"; changes: ThresholdChange[] }
  // Server menolak atau tidak terjangkau; tidak ada yang berubah.
  | { kind: "failed"; message: string };

const fieldLabels: Record<
  IncidentKind,
  { threshold: string | null; forSeconds: string | null }
> = {
  queue: {
    threshold: "Ambang pemakaian antrean (%)",
    forSeconds: "Lama di atas ambang (detik)",
  },
  cpu: {
    threshold: "Ambang beban CPU (%)",
    forSeconds: "Lama di atas ambang (detik)",
  },
  port: {
    threshold: "Ambang error interface (error/menit)",
    forSeconds: "Lama di atas ambang (detik)",
  },
  optical: { threshold: "Ambang Rx ONU (dBm)", forSeconds: null },
  offline: {
    threshold: null,
    forSeconds: "Lama terputus sebelum alert (detik)",
  },
};

const blockedButton =
  "aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

const forbiddenReason = "Hanya admin yang dapat mengubah ambang batas";

export function ThresholdSettings() {
  const baseId = useId();
  const canManage = useCanDo("manageThresholds");
  const { values: saved, status } = useSyncExternalStore(
    subscribeThresholds,
    getThresholdsSnapshot,
    getThresholdsServerSnapshot,
  );
  const [edits, setEdits] = useState<Edits>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState(false);
  const loadBlocked =
    status === "loading"
      ? "Memuat ambang dari database"
      : status === "error"
        ? "Ambang belum termuat dari database"
        : null;

  const savedTexts = textsFromValues(saved);
  const texts = {} as ThresholdTexts;
  for (const kind of ruleKinds) {
    texts[kind] = { ...savedTexts[kind], ...edits[kind] };
  }
  const { values, errors } = evaluateTexts(texts, saved);
  const changes = changedThresholds(saved, values);
  const changedKinds = new Set(changes.map((change) => change.kind));
  const isChanged = (kind: IncidentKind) =>
    changedKinds.has(kind) || errors[kind] !== undefined;
  const dirty = ruleKinds.some(isChanged);
  const errorCount = countThresholdErrors(errors);
  const hasEdits = Object.keys(edits).length > 0;

  const resetChanges = changedThresholds(saved, defaultThresholds());
  const resetKinds = ruleKinds.filter((kind) =>
    resetChanges.some((change) => change.kind === kind),
  );

  // Alasan tombol tidak berlaku, ditulis sebagai teks. Tombolnya sendiri tetap
  // bisa difokus (aria-disabled), supaya papan ketik tidak kehilangan tempat.
  const saveBlocked = !canManage
    ? forbiddenReason
    : (loadBlocked ??
      (saving
        ? "Sedang menyimpan"
        : errorCount > 0
          ? `Perbaiki ${errorCount} isian yang salah`
          : !dirty
            ? "Tidak ada perubahan"
            : null));
  const cancelBlocked = hasEdits ? null : "Tidak ada perubahan";
  const resetAllBlocked = !canManage
    ? forbiddenReason
    : (loadBlocked ??
      (saving
        ? "Sedang menyimpan"
        : isDefaultThresholds(saved) && !hasEdits
          ? "Sudah memakai nilai bawaan"
          : null));

  const fieldId = (kind: IncidentKind, field: ThresholdField) =>
    `${baseId}-${kind}-${field}`;

  function edit(kind: IncidentKind, field: ThresholdField, text: string) {
    setNotice(null);
    setEdits((current) => {
      const rule = { ...current[kind] };
      // Mengetik kembali nilai tersimpan sama dengan tidak mengubah.
      if (text === savedTexts[kind][field]) delete rule[field];
      else rule[field] = text;
      const next = { ...current, [kind]: rule };
      if (Object.keys(rule).length === 0) delete next[kind];
      return next;
    });
  }

  // Mengisi draft satu aturan dengan nilai bawaan; belum tersimpan sampai
  // "Simpan ambang".
  function resetRule(kind: IncidentKind) {
    setNotice(null);
    const defaults = textsFromValues(defaultThresholds())[kind];
    setEdits((current) => {
      const rule = { ...current[kind] };
      for (const field of thresholdFields) {
        if (defaults[field] === savedTexts[kind][field]) delete rule[field];
        else rule[field] = defaults[field];
      }
      const next = { ...current, [kind]: rule };
      if (Object.keys(rule).length === 0) delete next[kind];
      return next;
    });
  }

  function focusFirstInvalid() {
    for (const kind of ruleKinds) {
      for (const field of thresholdFields) {
        if (errors[kind]?.[field]) {
          document.getElementById(fieldId(kind, field))?.focus();
          return;
        }
      }
    }
  }

  async function handleSave() {
    if (saveBlocked !== null) {
      if (errorCount > 0) focusFirstInvalid();
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const result = await saveThresholds(values);
      if (!result.ok) {
        setNotice({ kind: "failed", message: result.message });
        return;
      }
      setNotice({ kind: "saved", changes });
      setEdits({});
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (cancelBlocked !== null) return;
    setNotice(null);
    setEdits({});
  }

  async function confirmReset() {
    setSaving(true);
    setNotice(null);
    try {
      const result = await resetSavedThresholds();
      if (!result.ok) {
        setNotice({ kind: "failed", message: result.message });
        return;
      }
      setEdits({});
      setNotice({ kind: "reset", changes: resetChanges });
    } finally {
      setSaving(false);
    }
  }

  const titleId = `${baseId}-title`;
  const reasonId = (name: string) => `${baseId}-reason-${name}`;

  return (
    <section
      aria-labelledby={titleId}
      data-testid="threshold-settings"
      className="space-y-5"
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight">
            Ambang alert
          </h2>
          <p className="text-sm text-muted-foreground">
            Menentukan batas kapan sebuah kondisi dianggap sebagai gangguan.
            Ubah angkanya di kartu aturan, lalu simpan.
          </p>
        </div>
        <p
          data-testid="threshold-honesty"
          className="rounded-lg border bg-card p-3 text-sm text-foreground"
        >
          Nilai ini tersimpan di database (tabel alert_thresholds) dan berlaku
          untuk semua petugas. Rule engine di backend membacanya saat backend
          dinyalakan, jadi ambang baru dipakai setelah backend di-restart.
          Daftar anomali dan alert tiruan mode demo tetap memakai aturan bawaan.
          Tombol <strong>Simpan Perubahan</strong> dan{" "}
          <strong>Reset Bawaan</strong> di bagian atas halaman tidak mencakup
          tab ini; pakai tombol di bawah kartu.
        </p>
        {status === "error" && (
          <div
            role="alert"
            data-testid="threshold-load-error"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground"
          >
            <CircleAlert
              className="size-4 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <span className="flex-1">
              Ambang tidak bisa dimuat dari database. Yang tampil adalah nilai
              bawaan; menyimpan diblokir sampai berhasil dimuat.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void thresholdRegistry.refresh()}
            >
              Coba muat lagi
            </Button>
          </div>
        )}
      </div>

      {/* Satu form untuk semua kartu: Enter di isian mana pun menyimpan, dan
          noValidate menyerahkan pemeriksaan ke evaluateTexts (pesan Indonesia
          dengan aturan yang sama dengan penyimpanan), bukan ke gelembung bawaan
          peramban. Tombol lain berjenis button supaya tidak ikut mengirim. */}
      <form
        noValidate
        data-testid="threshold-form"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
        className="space-y-5"
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {ruleKinds.map((kind) => (
            <RuleCard
              key={kind}
              kind={kind}
              baseId={baseId}
              texts={texts[kind]}
              errors={errors[kind]}
              values={values[kind]}
              changed={isChanged(kind)}
              atDefault={
                errors[kind] === undefined &&
                edits[kind] === undefined &&
                ruleAtDefault(kind, saved[kind])
              }
              onEdit={edit}
              onReset={resetRule}
            />
          ))}
        </div>

        <div className="space-y-3">
          <div
            role="status"
            data-testid="threshold-status"
            className="min-h-6 text-sm"
          >
            {notice?.kind === "failed" ? (
              <p
                data-testid="threshold-failed"
                className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 font-medium text-foreground"
              >
                <CircleAlert
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <span>{notice.message}</span>
              </p>
            ) : notice ? (
              <div
                data-testid="threshold-saved"
                data-kind={notice.kind}
                className="space-y-1.5 rounded-lg border border-success/40 bg-success/10 p-3 text-foreground"
              >
                <p className="flex items-center gap-2 font-medium">
                  <CircleCheck
                    className="size-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  {notice.kind === "saved"
                    ? "Ambang disimpan di database"
                    : "Ambang dikembalikan ke bawaan di database"}
                </p>
                <p className="pl-6">
                  Rule engine backend memakai nilai ini setelah backend
                  di-restart.
                </p>
                {notice.changes.length > 0 ? (
                  <ul
                    data-testid="threshold-saved-changes"
                    className="list-disc space-y-0.5 pl-9"
                  >
                    {notice.changes.map((change) => (
                      <li key={`${change.kind}-${change.field}`}>
                        {describeChange(change)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="pl-6">Tidak ada nilai yang berubah.</p>
                )}
              </div>
            ) : dirty ? (
              <p
                data-testid="threshold-unsaved"
                className="flex items-center gap-2 font-medium text-foreground"
              >
                <CircleDot
                  className="size-4 shrink-0 text-warning"
                  aria-hidden="true"
                />
                Ada perubahan yang belum disimpan
              </p>
            ) : null}
          </div>

          <div
            data-testid="threshold-actions"
            className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start"
          >
            <div className="flex flex-col gap-1">
              <Button
                type="submit"
                aria-disabled={saveBlocked !== null}
                aria-describedby={saveBlocked ? reasonId("save") : undefined}
                className={blockedButton}
              >
                <Save aria-hidden="true" />
                Simpan ambang
              </Button>
              {saveBlocked && (
                <span
                  id={reasonId("save")}
                  data-testid="save-reason"
                  className="text-xs text-muted-foreground"
                >
                  {saveBlocked}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <Button
                type="button"
                variant="outline"
                aria-disabled={cancelBlocked !== null}
                aria-describedby={
                  cancelBlocked ? reasonId("cancel") : undefined
                }
                onClick={handleCancel}
                className={blockedButton}
              >
                <Undo2 aria-hidden="true" />
                Batalkan perubahan
              </Button>
              {cancelBlocked && (
                <span
                  id={reasonId("cancel")}
                  data-testid="cancel-reason"
                  className="text-xs text-muted-foreground"
                >
                  {cancelBlocked}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <AlertDialog>
                {/* onClick ada di Trigger, bukan di Button anak: hanya begitu
                  preventDefault mencegah dialog terbuka. */}
                <AlertDialogTrigger
                  asChild
                  onClick={(event) => {
                    if (resetAllBlocked !== null) event.preventDefault();
                  }}
                >
                  <Button
                    type="button"
                    variant="outline"
                    aria-disabled={resetAllBlocked !== null}
                    aria-describedby={
                      resetAllBlocked ? reasonId("reset") : undefined
                    }
                    className={blockedButton}
                  >
                    <RotateCcw aria-hidden="true" />
                    Kembalikan semua ke bawaan
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent data-testid="threshold-reset-dialog">
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Kembalikan semua ambang ke bawaan?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {resetKinds.length > 0 ? (
                        <>
                          <strong
                            data-testid="threshold-reset-count"
                            className="text-foreground"
                          >
                            {resetKinds.length} aturan
                          </strong>{" "}
                          akan kembali ke nilai bawaan:{" "}
                          {resetKinds
                            .map((kind) => incidentLabels[kind])
                            .join(", ")}
                          .
                        </>
                      ) : (
                        <>Semua aturan sudah memakai nilai bawaan.</>
                      )}
                      {hasEdits &&
                        " Perubahan yang belum disimpan ikut dibuang."}{" "}
                      Pengembalian ini langsung disimpan di database.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void confirmReset()}>
                      Ya, kembalikan ke bawaan
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              {resetAllBlocked && (
                <span
                  id={reasonId("reset")}
                  data-testid="reset-reason"
                  className="text-xs text-muted-foreground"
                >
                  {resetAllBlocked}
                </span>
              )}
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}

function ruleAtDefault(kind: IncidentKind, rule: RuleValues) {
  const defaults = defaultThresholds()[kind];
  return (
    rule.threshold === defaults.threshold &&
    rule.forSeconds === defaults.forSeconds
  );
}

interface RuleCardProps {
  kind: IncidentKind;
  baseId: string;
  texts: Record<ThresholdField, string>;
  errors: RuleErrors | undefined;
  // Nilai yang sah dari isian sekarang (kolom yang salah memakai nilai tersimpan).
  values: RuleValues;
  changed: boolean;
  // Nilai tersimpan dan isiannya sudah sama dengan bawaan.
  atDefault: boolean;
  onEdit: (kind: IncidentKind, field: ThresholdField, text: string) => void;
  onReset: (kind: IncidentKind) => void;
}

function RuleCard({
  kind,
  baseId,
  texts,
  errors,
  values,
  changed,
  atDefault,
  onEdit,
  onReset,
}: RuleCardProps) {
  const limit = thresholdLimits[kind];
  const labels = fieldLabels[kind];
  const defaults = defaultThresholds()[kind];
  const direction = describeDirection(kind);
  const resetReasonId = `${baseId}-${kind}-reset-reason`;

  return (
    <Card
      data-testid="threshold-card"
      data-kind={kind}
      data-changed={changed}
      data-invalid={errors !== undefined}
      className="min-w-0 gap-4 py-5"
    >
      <CardHeader className="gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base leading-tight font-semibold">
            {incidentLabels[kind]}
          </h3>
          {changed && (
            <span
              data-testid="rule-changed"
              className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
            >
              <Pencil className="size-3" aria-hidden="true" />
              Berubah
            </span>
          )}
        </div>
        <p
          data-testid="rule-sentence"
          className="text-sm font-medium text-foreground"
        >
          {describeRule(kind, values)}
        </p>
        {errors !== undefined && (
          <p className="text-xs text-muted-foreground">
            Isian yang salah belum dipakai dalam kalimat ini.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {labels.threshold !== null && limit.threshold !== null ? (
          <NumberField
            id={`${baseId}-${kind}-threshold`}
            testId="threshold-input"
            label={labels.threshold}
            unit={limit.unit}
            text={texts.threshold}
            error={errors?.threshold}
            inputMode="decimal"
            hint={
              <>
                Bawaan: {formatValue(kind, "threshold", defaults.threshold)}.{" "}
                {describeLimit(kind, "threshold")}
                {direction !== null && <> {direction}</>}
              </>
            }
            onChange={(text) => onEdit(kind, "threshold", text)}
          />
        ) : (
          <p
            data-testid="threshold-none"
            className="text-sm text-muted-foreground"
          >
            Tanpa ambang angka: yang dinilai hanya lama pelanggan terputus.
          </p>
        )}

        {labels.forSeconds !== null && limit.forSeconds.editable ? (
          <NumberField
            id={`${baseId}-${kind}-forSeconds`}
            testId="duration-input"
            label={labels.forSeconds}
            unit="detik"
            text={texts.forSeconds}
            error={errors?.forSeconds}
            inputMode="numeric"
            preview={
              errors?.forSeconds === undefined &&
              formatSeconds(values.forSeconds) !== `${values.forSeconds} detik`
                ? `= ${formatSeconds(values.forSeconds)}`
                : null
            }
            hint={
              <>
                Bawaan: {durationText(defaults.forSeconds)}.{" "}
                {describeLimit(kind, "forSeconds")}
              </>
            }
            onChange={(text) => onEdit(kind, "forSeconds", text)}
          />
        ) : (
          <p
            data-testid="duration-fixed"
            className="flex items-start gap-1.5 text-sm text-muted-foreground"
          >
            <Zap className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Langsung, tanpa jeda: alert muncul begitu bacaan melewati ambang.
            </span>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="rule-reset"
            aria-label={`Kembalikan ke bawaan: ${incidentLabels[kind]}`}
            aria-disabled={atDefault}
            aria-describedby={atDefault ? resetReasonId : undefined}
            onClick={() => {
              if (!atDefault) onReset(kind);
            }}
            className={blockedButton}
          >
            <RotateCcw aria-hidden="true" />
            Kembalikan ke bawaan
          </Button>
          {atDefault && (
            <span
              id={resetReasonId}
              data-testid="rule-reset-reason"
              className="text-xs text-muted-foreground"
            >
              Sudah nilai bawaan
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// "3 menit (180 detik)", atau "30 detik" bila sudah dalam detik.
function durationText(seconds: number) {
  const human = formatSeconds(seconds);
  return human === `${seconds} detik` ? human : `${human} (${seconds} detik)`;
}

interface NumberFieldProps {
  id: string;
  testId: string;
  label: string;
  unit: string;
  text: string;
  error: string | undefined;
  inputMode: "decimal" | "numeric";
  hint: ReactNode;
  preview?: string | null;
  onChange: (text: string) => void;
}

// Isian angka sebagai TEKS (bukan type="number"): peramban tidak boleh
// menafsirkan "1e2" atau mengganti koma, dan galatnya harus bisa dibaca kata
// demi kata. Galat ditulis di bawah isian dan dikaitkan lewat aria-describedby,
// bukan hanya diberi warna.
function NumberField({
  id,
  testId,
  label,
  unit,
  text,
  error,
  inputMode,
  hint,
  preview,
  onChange,
}: NumberFieldProps) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const previewId = `${id}-preview`;
  const describedBy = [
    hintId,
    preview ? previewId : null,
    error ? errorId : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          data-testid={testId}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          spellCheck={false}
          value={text}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
          className="w-28 tabular-nums"
        />
        <span aria-hidden="true" className="text-sm text-muted-foreground">
          {unit}
        </span>
        {preview && (
          <span
            id={previewId}
            data-testid="duration-preview"
            className="text-sm text-muted-foreground"
          >
            {preview}
          </span>
        )}
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        {hint}
      </p>
      {error && (
        <p
          id={errorId}
          data-testid="field-error"
          className="flex items-start gap-1.5 text-sm font-medium text-destructive"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
