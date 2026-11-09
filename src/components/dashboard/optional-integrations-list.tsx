"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Layers,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ExternalLink,
  Sparkles,
  Server,
  Network,
  Activity,
  MessageSquare,
  Receipt,
} from "lucide-react";
import {
  evaluateOptionalIntegrations,
  type OptionalIntegrationItem,
  type OptionalIntegrationStatus,
} from "@/lib/dashboard/optional-integrations";

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  "opt-olt-hsgq": Network,
  "opt-genieacs-nbi": Server,
  "opt-netflow-collector": Activity,
  "opt-whatsapp-gateway": MessageSquare,
  "opt-billing-sync": Receipt,
};

export function OptionalIntegrationsList() {
  const [customStates, setCustomStates] = useState<
    Record<string, OptionalIntegrationStatus>
  >({
    "opt-olt-hsgq": "terkonfigurasi",
    "opt-whatsapp-gateway": "dalam-pengujian",
  });
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/onboarding/integrations")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.data?.items && Array.isArray(json.data.items)) {
          const map: Record<string, OptionalIntegrationStatus> = {};
          for (const item of json.data.items) {
            map[item.id] = item.status;
          }
          setCustomStates(map);
        }
      })
      .catch(() => null);
  }, []);

  const overview = evaluateOptionalIntegrations(process.env, customStates);

  const handleToggleStatus = async (
    id: string,
    current: OptionalIntegrationStatus,
  ) => {
    const next: OptionalIntegrationStatus =
      current === "terkonfigurasi"
        ? "belum-dikonfigurasi"
        : current === "belum-dikonfigurasi"
          ? "dalam-pengujian"
          : "terkonfigurasi";

    setCustomStates((prev) => ({ ...prev, [id]: next }));
    setNotice(`Status integrasi diperbarui menjadi "${next}".`);
    setTimeout(() => setNotice(null), 3000);

    // Kirim sinkronisasi ke backend
    await fetch("/api/onboarding/integrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: next }),
    }).catch(() => null);
  };

  return (
    <div
      data-testid="optional-integrations-list"
      className="flex flex-col gap-5 rounded-2xl border bg-card p-5 shadow-xs"
    >
      {/* Header Panel */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Daftar Integrasi Opsional Terpandu (Fase 6)
            </h3>
            <p className="text-xs text-muted-foreground">
              Modul tambahan yang dapat dikonfigurasi bertahap setelah gerbang
              router utama aktif.
            </p>
          </div>
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-xs text-primary"
        >
          <Sparkles className="h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Ringkasan Status */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-secondary/30 p-3.5">
          <span className="text-xs text-muted-foreground">
            Total Modul Opsional
          </span>
          <p className="mt-1 text-2xl font-bold text-foreground">
            {overview.total} Layanan
          </p>
        </div>
        <div className="rounded-xl border bg-emerald-50/40 p-3.5 dark:bg-emerald-950/20">
          <span className="text-xs text-emerald-800 dark:text-emerald-300">
            Sudah Terkonfigurasi
          </span>
          <p className="mt-1 text-2xl font-bold text-emerald-700 dark:text-emerald-400">
            {overview.configuredCount} Modul
          </p>
        </div>
        <div className="rounded-xl border bg-amber-50/40 p-3.5 dark:bg-amber-950/20">
          <span className="text-xs text-amber-800 dark:text-amber-300">
            Belum Dikonfigurasi
          </span>
          <p className="mt-1 text-2xl font-bold text-amber-700 dark:text-amber-400">
            {overview.unconfiguredCount} Modul
          </p>
        </div>
      </div>

      {/* Grid Kartu Integrasi Opsional */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {overview.items.map((item) => {
          const Icon = CATEGORY_ICONS[item.id] || Layers;
          const isConfigured = item.status === "terkonfigurasi";
          const isTesting = item.status === "dalam-pengujian";

          return (
            <div
              key={item.id}
              data-testid="optional-integration-card"
              data-integration-id={item.id}
              className={`flex flex-col justify-between gap-4 rounded-xl border p-4.5 transition-all ${
                isConfigured
                  ? "border-emerald-200/60 bg-emerald-50/20 dark:border-emerald-900/40 dark:bg-emerald-950/10"
                  : isTesting
                    ? "border-sky-200/60 bg-sky-50/20 dark:border-sky-900/40 dark:bg-sky-950/10"
                    : "border-border bg-card/60"
              }`}
            >
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">
                        {item.name}
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        {item.targetDeviceOrService}
                      </p>
                    </div>
                  </div>

                  {/* Badge Status */}
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(item.id, item.status)}
                    title="Klik untuk mengubah status simulasi"
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition-transform hover:scale-105 ${
                      isConfigured
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                        : isTesting
                          ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {isConfigured
                      ? "✓ Terkonfigurasi"
                      : isTesting
                        ? "⟳ Dalam Pengujian"
                        : "Belum Dikonfigurasi"}
                  </button>
                </div>

                <p className="text-xs text-muted-foreground">
                  {item.description}
                </p>

                {/* Manfaat Modul */}
                <div className="rounded-lg bg-secondary/40 p-2.5 text-[11px] text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    Manfaat ISP:{" "}
                  </span>
                  {item.benefit}
                </div>

                {/* Variabel Environment */}
                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="font-medium text-muted-foreground">
                    Env Kunci:
                  </span>
                  {item.requiredVars.map((v) => (
                    <code
                      key={v}
                      className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground"
                    >
                      {v}
                    </code>
                  ))}
                </div>
              </div>

              {/* Tautan Menuju Konfigurasi */}
              <div className="flex items-center justify-end border-t pt-3">
                <Link
                  href={item.routeUrl}
                  className="inline-flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-xs font-semibold text-foreground shadow-xs transition-colors hover:bg-secondary"
                >
                  <span>{item.routeLabel}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
