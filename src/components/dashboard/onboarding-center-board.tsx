"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Compass,
  CheckCircle2,
  Clock,
  Lock,
  ArrowRight,
  BookOpen,
  ShieldCheck,
  AlertCircle,
  HelpCircle,
  Sparkles,
  GitFork,
  Terminal,
} from "lucide-react";
import {
  MOCK_ONBOARDING_STEPS,
  MOCK_ONBOARDING_GUIDES,
  getMockOnboardingOverview,
  computeStepStatuses,
  isStepUnlocked,
  type OnboardingStep,
  type OnboardingStepType,
} from "@/lib/dashboard/onboarding-data";
import { OnboardingProgressTracker } from "./onboarding-progress-tracker";
import { OnboardingMikrotikForm } from "./onboarding-mikrotik-form";
import { OptionalIntegrationsList } from "./optional-integrations-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function OnboardingCenterBoard() {
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => {
    return new Set(
      MOCK_ONBOARDING_STEPS.filter((s) => s.status === "selesai").map((s) => s.id),
    );
  });

  useEffect(() => {
    fetch("/api/onboarding/steps")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.data?.completedStepIds && Array.isArray(json.data.completedStepIds)) {
          setCompletedIds(new Set(json.data.completedStepIds));
        }
      })
      .catch(() => null);
  }, []);

  const steps = computeStepStatuses(MOCK_ONBOARDING_STEPS, completedIds);
  const overview = getMockOnboardingOverview(steps);
  const [selectedFilter, setSelectedFilter] = useState<"semua" | OnboardingStepType>("semua");
  const [activeNotice, setActiveNotice] = useState<string | null>(null);
  const [showMikrotikForm, setShowMikrotikForm] = useState(false);

  const handleMikrotikSuccess = () => {
    const nextCompleted = new Set(completedIds);
    nextCompleted.add("step-router-mikrotik");
    setCompletedIds(nextCompleted);
    setActiveNotice("Langkah 1: Router MikroTik berhasil dikonfigurasi & diuji! Gerbang terbuka.");
    setShowMikrotikForm(false);
  };

  const filteredSteps = steps.filter((step) => {
    if (selectedFilter === "semua") return true;
    return step.type === selectedFilter;
  });

  const handleToggleStep = (stepId: string) => {
    const nextCompleted = new Set(completedIds);
    const target = steps.find((s) => s.id === stepId);

    if (nextCompleted.has(stepId)) {
      nextCompleted.delete(stepId);
      setActiveNotice(`Langkah "${target?.title ?? stepId}" ditandai belum selesai.`);
    } else {
      // Periksa apakah prasyarat sudah terpenuhi
      if (target) {
        const check = isStepUnlocked(target, completedIds);
        if (!check.unlocked) {
          setActiveNotice(
            `Tidak dapat menyelesaikan: Lengkapi prasyarat terlebih dahulu (${check.missingPrereqs.join(", ")}).`,
          );
          setTimeout(() => setActiveNotice(null), 4000);
          return;
        }
      }
      nextCompleted.add(stepId);
      setActiveNotice(`Langkah "${target?.title ?? stepId}" berhasil diselesaikan.`);
    }

    setCompletedIds(nextCompleted);
    setTimeout(() => setActiveNotice(null), 3500);
  };

  return (
    <div data-testid="onboarding-center-board" className="flex flex-col gap-6">
      {/* Banner Notifikasi Aksi */}
      {activeNotice && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-xs text-primary"
        >
          <Sparkles className="h-4 w-4 shrink-0" />
          <span>{activeNotice}</span>
        </div>
      )}

      {/* Tracker Indikator Kemajuan Onboarding Operator */}
      <OnboardingProgressTracker overview={overview} steps={steps} />

      {/* Kartu Ringkasan Progres & Status Gerbang */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Progres Keseluruhan */}
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Progres Onboarding
            </span>
            <Compass className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight">
              {overview.completionPercentage}%
            </span>
            <span className="text-xs text-muted-foreground">
              ({overview.completedSteps} dari {overview.totalSteps} langkah)
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${overview.completionPercentage}%` }}
            />
          </div>
        </div>

        {/* Gerbang Wajib */}
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Gerbang Konfigurasi Wajib
            </span>
            {overview.isGatePassed ? (
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            )}
          </div>
          <div className="mt-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                overview.isGatePassed
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
              }`}
            >
              {overview.isGatePassed ? "LULUS (Terbuka)" : "DITAHAN (Router Wajib)"}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {overview.isGatePassed
              ? "Router MikroTik aktif; modul opsional siap diintegrasikan."
              : "Router MikroTik wajib diuji sebelum modul lain dibuka."}
          </p>
        </div>

        {/* Langkah Wajib Selesai */}
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Langkah Wajib
            </span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight">
              {overview.requiredCompleted} / {overview.requiredTotal}
            </span>
            <span className="text-xs text-muted-foreground">Langkah Selesai</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Prasyarat go-live dan pembukaan seluruh navigasi operasional.
          </p>
        </div>

        {/* Estimasi Waktu */}
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Estimasi Total Waktu
            </span>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight">~35 Menit</span>
            <span className="text-xs text-muted-foreground">dari Nol ke Go-Live</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Terdiri dari 3 langkah wajib dan 5 langkah opsional terpandu.
          </p>
        </div>
      </div>

      {/* Tombol & Panel Form Konfigurasi MikroTik Wajib */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between rounded-xl border bg-secondary/30 p-3 sm:p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-semibold text-foreground">
                Langkah 1: Konfigurasi & Uji REST API MikroTik (Gerbang Wajib)
              </p>
              <p className="text-[11px] text-muted-foreground">
                Buka form untuk menguji koneksi langsung ke router dan membuka gerbang onboarding.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowMikrotikForm((v) => !v)}
            className="rounded-lg border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-secondary"
          >
            {showMikrotikForm ? "Tutup Form" : "Buka Form Uji MikroTik"}
          </button>
        </div>

        {showMikrotikForm && (
          <OnboardingMikrotikForm onSuccess={handleMikrotikSuccess} />
        )}
      </div>

      {/* Tabs Konten Onboarding */}
      <Tabs defaultValue="langkah" className="w-full">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4 sm:w-auto">
          <TabsTrigger value="langkah" className="text-xs sm:text-sm">
            Daftar Langkah ({steps.length})
          </TabsTrigger>
          <TabsTrigger value="integrasi" className="text-xs sm:text-sm">
            Integrasi Opsional
          </TabsTrigger>
          <TabsTrigger value="prasyarat" className="text-xs sm:text-sm">
            Pohon Prasyarat
          </TabsTrigger>
          <TabsTrigger value="panduan" className="text-xs sm:text-sm">
            Panduan & Tutorial
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Daftar Langkah */}
        <TabsContent value="langkah" className="mt-4 flex flex-col gap-4">
          {/* Sub-filter Langkah */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Filter:</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedFilter("semua")}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    selectedFilter === "semua"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  }`}
                >
                  Semua ({steps.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedFilter("wajib")}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    selectedFilter === "wajib"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  }`}
                >
                  Wajib ({overview.requiredTotal})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedFilter("opsional")}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    selectedFilter === "opsional"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  }`}
                >
                  Opsional Terpandu ({steps.length - overview.requiredTotal})
                </button>
              </div>
            </div>

            <span className="text-xs text-muted-foreground">
              Menampilkan {filteredSteps.length} langkah
            </span>
          </div>

          {/* Daftar Kartu Langkah */}
          <div className="flex flex-col gap-3">
            {filteredSteps.map((step) => {
              const isDone = step.status === "selesai";
              const isInProgress = step.status === "sedang-berjalan";
              const isLocked = step.status === "terkunci";
              const prereqCheck = isStepUnlocked(step, completedIds);

              return (
                <div
                  key={step.id}
                  data-testid="onboarding-step-card"
                  data-step-id={step.id}
                  data-step-status={step.status}
                  className={`flex flex-col justify-between gap-4 rounded-xl border p-4 transition-all sm:flex-row sm:items-start ${
                    isDone
                      ? "border-emerald-200/60 bg-emerald-50/20 dark:border-emerald-900/40 dark:bg-emerald-950/10"
                      : isLocked
                        ? "border-border/60 bg-muted/20 opacity-80"
                        : isInProgress
                          ? "border-primary/40 bg-card shadow-xs"
                          : "border-border bg-card/60"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => handleToggleStep(step.id)}
                      title={
                        isDone
                          ? "Tandai belum selesai"
                          : isLocked
                            ? "Terkunci: Prasyarat belum terpenuhi"
                            : "Tandai selesai"
                      }
                      className="mt-0.5 shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {isDone ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      ) : isLocked ? (
                        <Lock className="h-5 w-5 text-muted-foreground" />
                      ) : isInProgress ? (
                        <Clock className="h-5 w-5 text-primary" />
                      ) : (
                        <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/40" />
                      )}
                    </button>

                    <div className="flex flex-col">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {step.title}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
                            step.type === "wajib"
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                              : "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
                          }`}
                        >
                          {step.type}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          • ~{step.estimatedMinutes} menit
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {step.description}
                      </p>

                      {/* Indikator Prasyarat */}
                      {step.prerequisiteTitles && step.prerequisiteTitles.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="font-medium text-muted-foreground">
                            Prasyarat:
                          </span>
                          {step.prerequisiteTitles.map((pTitle) => (
                            <span
                              key={pTitle}
                              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${
                                prereqCheck.unlocked
                                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                                  : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                              }`}
                            >
                              {prereqCheck.unlocked ? (
                                <CheckCircle2 className="h-3 w-3" />
                              ) : (
                                <Lock className="h-3 w-3" />
                              )}
                              {pTitle}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Instruksi & CLI */}
                      {step.instruction && (
                        <div className="mt-2 rounded-lg bg-muted/40 p-2 text-[11px] text-muted-foreground">
                          <span className="font-semibold text-foreground">
                            Panduan Teknis:{" "}
                          </span>
                          {step.instruction}
                        </div>
                      )}

                      {step.cliCommand && (
                        <div className="mt-1.5 flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 font-mono text-[11px] text-foreground">
                          <Terminal className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span>{step.cliCommand}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                    <Link
                      href={step.targetUrl}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium shadow-xs transition-colors ${
                        isLocked
                          ? "border-muted bg-muted/50 text-muted-foreground hover:bg-muted"
                          : "border-border bg-background text-foreground hover:bg-secondary hover:text-foreground"
                      }`}
                    >
                      <span>{step.targetLabel}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* Tab 2: Integrasi Opsional Terpandu */}
        <TabsContent value="integrasi" className="mt-4 flex flex-col gap-4">
          <OptionalIntegrationsList />
        </TabsContent>

        {/* Tab 3: Pohon Prasyarat (Dependency Chain) */}
        <TabsContent value="prasyarat" className="mt-4 flex flex-col gap-4">
          <div className="rounded-xl border bg-card p-5 shadow-xs">
            <div className="flex items-center gap-2">
              <GitFork className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                Pohon Ketergantungan Alur Integrasi (Prerequisite Map)
              </h3>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Visualisasi alur langkah berurutan: langkah berikutnya terbuka otomatis setelah prasyarat diselesaikan.
            </p>

            <div className="mt-5 flex flex-col gap-3">
              {steps.map((st) => {
                const prereqCheck = isStepUnlocked(st, completedIds);
                const isDone = st.status === "selesai";

                return (
                  <div
                    key={st.id}
                    className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs font-bold text-foreground">
                        {st.order}
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground">
                            {st.title}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.2 text-[10px] font-semibold uppercase ${
                              st.type === "wajib"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
                            }`}
                          >
                            {st.type}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {st.prerequisites.length === 0
                            ? "Titik Masuk Utama (Tanpa Prasyarat)"
                            : `Membutuhkan: ${st.prerequisites.join(", ")}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          isDone
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            : prereqCheck.unlocked
                              ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {isDone
                          ? "✓ Selesai"
                          : prereqCheck.unlocked
                            ? "Siap Dikerjakan"
                            : "🔒 Menunggu Prasyarat"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>

        {/* Tab 3: Panduan & Tutorial Menyalakan */}
        <TabsContent value="panduan" className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {MOCK_ONBOARDING_GUIDES.map((guide) => (
              <div
                key={guide.id}
                className="flex flex-col justify-between rounded-xl border bg-card p-5 shadow-xs"
              >
                <div>
                  <div className="flex items-center gap-2 text-primary">
                    <BookOpen className="h-4 w-4" />
                    <h3 className="text-sm font-semibold text-foreground">
                      {guide.title}
                    </h3>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {guide.summary}
                  </p>

                  <ol className="mt-4 flex flex-col gap-2.5 text-xs text-foreground/90">
                    {guide.steps.map((st, idx) => (
                      <li key={st} className="flex items-start gap-2">
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-bold text-muted-foreground">
                          {idx + 1}
                        </span>
                        <span>{st}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="mt-5 border-t pt-3">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <HelpCircle className="h-3.5 w-3.5" />
                    <span>Tutorial bawaan Fase 6</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border bg-secondary/30 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-4 w-4 text-primary shrink-0" />
              <div className="text-xs text-muted-foreground">
                <p className="font-semibold text-foreground">
                  Catatan Pengoperasian Mandiri:
                </p>
                <p className="mt-1">
                  Seluruh progres integrasi dan tutorial tersimpan di tabel database{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                    onboarding_steps
                  </code>{" "}
                  dan{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">
                    onboarding_progress
                  </code>
                  . Saat berpindah lingkungan atau naik versi ke server, progres tidak akan hilang.
                </p>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
