"use client";

import Link from "next/link";
import {
  Compass,
  CheckCircle2,
  Clock,
  ArrowRight,
  ShieldAlert,
  ShieldCheck,
  PlayCircle,
  Layers,
} from "lucide-react";
import type {
  OnboardingOverview,
  OnboardingStep,
} from "@/lib/dashboard/onboarding-data";

export interface OnboardingProgressTrackerProps {
  overview: OnboardingOverview;
  steps: readonly OnboardingStep[];
}

export function OnboardingProgressTracker({
  overview,
  steps,
}: OnboardingProgressTrackerProps) {
  // Cari langkah aktif berikutnya: langkah pertama yang belum selesai dan tidak terkunci
  const nextStep = steps.find(
    (s) => s.status !== "selesai" && s.status !== "terkunci",
  );

  const categories = [
    { key: "perangkat", label: "Perangkat & Jaringan" },
    { key: "metrik", label: "Metrik & NetFlow" },
    { key: "billing", label: "Billing & Pelanggan" },
    { key: "notifikasi", label: "WhatsApp & Notifikasi" },
    { key: "deploy", label: "Pengaman Deploy" },
  ] as const;

  return (
    <div
      data-testid="onboarding-progress-tracker"
      className="flex flex-col gap-5 rounded-2xl border bg-card p-5 shadow-xs"
    >
      {/* Header Tracker */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Compass className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Indikator Progres Onboarding Operator
            </h2>
            <p className="text-xs text-muted-foreground">
              Pelacakan kemajuan integrasi NOC ISP langkah demi langkah
            </p>
          </div>
        </div>

        {/* Status Gerbang Pill */}
        <div className="flex items-center gap-2">
          {overview.isGatePassed ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              Gerbang Wajib Lulus
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
              <ShieldAlert className="h-3.5 w-3.5" />
              Menunggu Router Wajib
            </span>
          )}
        </div>
      </div>

      {/* Progress Bar & Persentase */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tracking-tight text-foreground">
              {overview.completionPercentage}%
            </span>
            <span className="text-xs text-muted-foreground">
              ({overview.completedSteps} dari {overview.totalSteps} langkah
              selesai)
            </span>
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            {overview.totalSteps - overview.completedSteps} langkah tersisa
          </span>
        </div>

        <div className="h-3 w-full overflow-hidden rounded-full bg-secondary">
          <div
            data-testid="onboarding-progress-bar"
            className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${overview.completionPercentage}%` }}
          />
        </div>
      </div>

      {/* Timeline Stepper Dots */}
      <div className="hidden grid-cols-8 gap-2 pt-1 sm:grid">
        {steps.map((st, idx) => {
          const isDone = st.status === "selesai";
          const isCurrent = st.id === nextStep?.id;
          const isLocked = st.status === "terkunci";

          return (
            <div
              key={st.id}
              className="flex flex-col items-center gap-1 text-center"
              title={`${st.order}. ${st.title} (${st.status})`}
            >
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all ${
                  isDone
                    ? "bg-emerald-600 text-white shadow-xs dark:bg-emerald-500"
                    : isCurrent
                      ? "ring-4 ring-primary/20 bg-primary text-primary-foreground shadow-xs animate-pulse"
                      : isLocked
                        ? "bg-muted text-muted-foreground/60"
                        : "border-2 border-primary/40 bg-card text-foreground"
                }`}
              >
                {isDone ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <span>{idx + 1}</span>
                )}
              </div>
              <span className="line-clamp-1 max-w-[80px] text-[10px] text-muted-foreground">
                {st.title.replace(/^\d+\.\s*/, "")}
              </span>
            </div>
          );
        })}
      </div>

      {/* Rekomendasi Langkah Aktif Berikutnya */}
      {nextStep ? (
        <div className="flex flex-col justify-between gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <PlayCircle className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold tracking-wide text-primary uppercase">
                  Langkah Rekomendasi Berikutnya
                </span>
                <span className="rounded bg-primary/10 px-1.5 py-0.2 text-[10px] font-semibold text-primary">
                  {nextStep.type}
                </span>
              </div>
              <h3 className="mt-0.5 text-sm font-semibold text-foreground">
                {nextStep.title}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {nextStep.description}
              </p>
              {nextStep.instruction && (
                <p className="mt-1.5 text-[11px] font-medium text-foreground/80">
                  👉 Panduan: {nextStep.instruction}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-3 self-end sm:self-center">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>~{nextStep.estimatedMinutes} menit</span>
            </div>
            <Link
              href={nextStep.targetUrl}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
            >
              <span>Lanjutkan Sekarang</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-300">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="text-xs">
            <span className="font-semibold">
              Selamat! Seluruh langkah onboarding telah selesai.
            </span>
            <p className="text-muted-foreground">
              Sistem siap diverifikasi untuk tahap go-live produksi.
            </p>
          </div>
        </div>
      )}

      {/* Progres per Kategori Modul */}
      <div className="border-t pt-4">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-3">
          <Layers className="h-3.5 w-3.5" />
          <span>Kemajuan per Kategori Layanan:</span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {categories.map((cat) => {
            const catSteps = steps.filter((s) => s.category === cat.key);
            const catDone = catSteps.filter(
              (s) => s.status === "selesai",
            ).length;
            const catTotal = catSteps.length;
            const pct =
              catTotal === 0 ? 0 : Math.round((catDone / catTotal) * 100);

            return (
              <div
                key={cat.key}
                className="flex flex-col gap-1 rounded-lg border bg-secondary/20 p-2.5 text-xs"
              >
                <span className="font-medium text-foreground truncate">
                  {cat.label}
                </span>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    {catDone}/{catTotal} selesai
                  </span>
                  <span className="font-semibold">{pct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
