"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Info,
  Loader2,
  Wrench,
  XOctagon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OPTICAL_TONE_CLASS } from "@/lib/dashboard/optical";
import {
  diagnosticLayers,
  layerLabel,
  triggerReasonLabels,
  type DiagnosticLayer,
  type DiagnosticRunDto,
  type FindingDto,
  type FindingStatus,
  type VerdictScope,
} from "@/lib/diagnostics";
import { layerIcons } from "./diagnostic-layer-meta";
import {
  layerInfo,
  metricInfo,
  mikrotikSources,
} from "@/lib/diagnostic-sources";
export async function errorMessage(res: Response, fallback: string) {
  const json = (await res.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return json?.error?.message ?? `${fallback} (HTTP ${res.status}).`;
}

const when = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Jakarta",
});
export const formatWhen = (iso: string | null) =>
  iso ? when.format(new Date(iso)) : "—";

const statusView: Record<
  FindingStatus,
  {
    label: string;
    tone: keyof typeof OPTICAL_TONE_CLASS;
    Icon: typeof CheckCircle2;
  }
> = {
  ok: { label: "Normal", tone: "success", Icon: CheckCircle2 },
  warn: { label: "Peringatan", tone: "warning", Icon: AlertTriangle },
  fail: { label: "Bermasalah", tone: "danger", Icon: XOctagon },
  unchecked: {
    label: "Tidak dapat diperiksa",
    tone: "neutral",
    Icon: CircleHelp,
  },
};

export function FindingStatusPill({ status }: { status: FindingStatus }) {
  const v = statusView[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        OPTICAL_TONE_CLASS[v.tone],
      )}
    >
      <v.Icon aria-hidden="true" className="size-3" />
      {v.label}
    </span>
  );
}

export const isRunActive = (run: Pick<DiagnosticRunDto, "status">) =>
  run.status === "queued" || run.status === "running";

// Asal diagnosa: manual (siapa) atau otomatis (pemicu), plus penggabungan.
export function RunOrigin({ run }: { run: DiagnosticRunDto }) {
  const reason = triggerReasonLabels[run.triggerReason] ?? run.triggerReason;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant={run.triggerMode === "manual" ? "default" : "secondary"}>
        {run.triggerMode === "manual" ? "Manual" : "Otomatis"}
      </Badge>
      <span className="text-xs text-muted-foreground">
        {run.triggerMode === "manual"
          ? `oleh ${run.triggeredBy ?? "—"}`
          : reason}
        {run.mergedCount > 0 && ` · digabung ${run.mergedCount} kejadian`}
      </span>
    </span>
  );
}

// Memuat satu run dan memperbaruinya tiap detik selama masih berjalan.
// Pasang dengan key={runId} supaya keadaan mulai bersih untuk run lain.
function useDiagnosticRun(runId: string) {
  const [run, setRun] = useState<DiagnosticRunDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: NodeJS.Timeout | number | undefined;
    async function load() {
      try {
        const res = await fetch(
          `/api/anomalies/diagnostics/${encodeURIComponent(runId)}`,
          {
            cache: "no-store",
          },
        );
        if (!res.ok)
          throw new Error(await errorMessage(res, "Gagal memuat diagnosa"));
        const { data } = (await res.json()) as { data: DiagnosticRunDto };
        if (stopped) return;
        setRun(data);
        setError(null);
        if (isRunActive(data)) timer = setTimeout(load, 1000);
      } catch (e) {
        if (stopped) return;
        setError(e instanceof Error ? e.message : "Gagal memuat diagnosa.");
        timer = setTimeout(load, 3000);
      }
    }
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [runId]);
  return { run, error };
}

const eventTone: Record<string, string> = {
  log_logout: "text-destructive",
  log_no_address: "text-destructive",
  log_auth_fail: "text-destructive",
  log_link_down: "text-destructive",
  log_addr_conflict: "text-warning",
  log_firewall: "text-warning",
  alert: "text-warning",
  log_login: "text-success",
  log_link_up: "text-success",
  alert_end: "text-success",
};

function relative(ms: number) {
  const sec = Math.round(Math.abs(ms) / 1000);
  if (sec < 30) return "saat keluhan";
  const text =
    sec < 3600
      ? `${Math.round(sec / 60)} mnt`
      : `${(sec / 3600).toFixed(1)} jam`;
  return ms < 0 ? `${text} sebelum` : `${text} sesudah`;
}

const scopeLabel: Record<string, string> = {
  khusus: "khusus pelanggan",
  umum: "semua pelanggan",
  mungkin: "mungkin (syarat tak terbaca)",
};

// Rule firewall/NAT yang mengenai pelanggan, urut tabel dan posisi.
function FirewallRuleTable({
  rules,
}: {
  rules: NonNullable<DiagnosticRunDto["firewallRules"]>;
}) {
  return (
    <div
      className="mt-2 overflow-auto rounded-md border text-xs"
      role="region"
      aria-label="Rule firewall yang mengenai pelanggan"
      tabIndex={0}
    >
      <table className="w-full min-w-[36rem] text-left text-xs">
        <caption className="sr-only">
          Rule firewall dan NAT yang mengenai trafik pelanggan
        </caption>
        <thead className="border-b bg-muted/40 text-muted-foreground">
          <tr>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Rule
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Aksi
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Berlaku untuk
            </th>
            <th scope="col" className="px-2 py-1.5 font-medium">
              Syarat
            </th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium">
              Hit paket
            </th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr
              key={`${r.table}-${r.ruleIndex}`}
              className={cn(
                "border-t align-top hover:bg-muted/20",
                r.disabled && "text-muted-foreground line-through",
              )}
            >
              <td className="px-2 py-1 font-mono whitespace-nowrap">
                {r.table} {r.chain} #{r.ruleIndex}
                {r.comment && (
                  <span className="block font-sans text-[11px] text-muted-foreground no-underline">
                    {r.comment}
                  </span>
                )}
              </td>
              <td className="px-2 py-1 whitespace-nowrap">
                {r.action}
                {r.disabled && (
                  <span className="ml-1 no-underline">(nonaktif)</span>
                )}
              </td>
              <td className="px-2 py-1">{scopeLabel[r.scope] ?? r.scope}</td>
              <td className="px-2 py-1 font-mono break-all text-[11px]">
                {r.summary || "—"}
              </td>
              <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">
                {new Intl.NumberFormat("id-ID").format(r.matchedPackets)}
                {r.isStale && (
                  <span className="block text-warning text-[11px]">tidak pernah kena</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Kejadian log dan alert diurut waktu, dengan penanda keluhan di posisinya.
function Timeline({ run }: { run: DiagnosticRunDto }) {
  const anchorIso = run.complaintAt ?? run.createdAt;
  const anchor = new Date(anchorIso).getTime();
  const items = run.timeline ?? [];
  const before = items.filter((e) => new Date(e.at).getTime() <= anchor);
  const after = items.filter((e) => new Date(e.at).getTime() > anchor);
  const row = (e: DiagnosticRunDto["timeline"][number], i: number) => (
    <li
      key={`${e.at}-${i}`}
      className="flex flex-col gap-0.5 py-1 sm:flex-row sm:gap-2.5 text-xs"
      data-testid="timeline-event"
    >
      <span className="w-36 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
        {formatWhen(e.at)}
        <span className="block text-muted-foreground/80">
          {relative(new Date(e.at).getTime() - anchor)}
        </span>
      </span>
      <span className="min-w-0">
        <span className={cn("font-medium", eventTone[e.kind])}>{e.label}</span>
        <span className="block break-words text-[11px] text-muted-foreground">
          {e.detail} · {e.source}
        </span>
      </span>
    </li>
  );
  return (
    <section
      aria-labelledby={`timeline-${run.id}`}
      className="rounded-lg border border-border bg-card/60 p-2.5"
    >
      <h3 id={`timeline-${run.id}`} className="text-xs font-semibold text-foreground">
        Garis waktu terhadap keluhan
      </h3>
      {items.length === 0 ? (
        <p className="py-1.5 text-xs text-muted-foreground">
          Tidak ada kejadian log atau alert pelanggan di sekitar keluhan (lihat
          cakupan log di lapisan Log).
        </p>
      ) : (
        <ol className="divide-y divide-border/40 text-xs">
          {before.map(row)}
          <li
            className="py-1 text-xs font-semibold text-primary"
            data-testid="timeline-complaint"
          >
            ▶ Keluhan · {formatWhen(anchorIso)}
          </li>
          {after.map(row)}
        </ol>
      )}
    </section>
  );
}

export const scopeBadgeLabels: Record<VerdictScope, string> = {
  own: "Gangguan pelanggan ini",
  shared: "Gangguan bersama",
  unknown: "Cakupan belum dapat dipastikan",
};

interface ResolveAction {
  title: string;
  steps: string[];
}

export function getActionPlan(run: DiagnosticRunDto): ResolveAction {
  const isShared = run.verdictScope === "shared" || run.isSharedFault;
  const layer = run.verdictLayer;

  if (isShared) {
    const rootName = run.verdictRoot?.name ?? "infrastruktur bersama";
    return {
      title: "Gangguan Bersama (Infrastruktur / Massal)",
      steps: [
        `JANGAN kirim teknisi ke rumah pelanggan. Sumber kendala di ${rootName} (${run.verdictRoot?.affected ?? "beberapa"} pelanggan).`,
        "Periksa link antarmuka hulu/OLT/Core router dan koordinasikan perbaikan jaringan bersama.",
        "Pantau pemulihan layanan massal sebelum melakukan pengujian lanjutan ke pelanggan.",
      ],
    };
  }

  if (layer === "aktif") {
    return {
      title: "Pengukuran Aktif & Konektivitas Pelanggan",
      steps: [
        "Periksa fisik kabel drop dan roset: pastikan konektor SC/UPC tidak longgar, terjepit, atau putus.",
        "Cek catu daya dan lampu indikator ONT (pastikan indikator PON hijau stabil dan LOS tidak merah).",
        "Jika perangkat hidup dan optik normal tetapi ping 100% loss, verifikasi tabel ARP di MikroTik dan coba reboot ONT.",
      ],
    };
  }

  if (layer === "optik") {
    return {
      title: "Redaman Sinyal Optik Buruk",
      steps: [
        "Bersihkan konektor fiber optik (SC/UPC) pada adaptor ODP dan roset pelanggan menggunakan fiber cleaner.",
        "Periksa tekukan tajam (bending) atau kabel drop yang terjepit di sepanjang jalur ke rumah pelanggan.",
        "Jika redaman tetap di bawah -24 dBm, lakukan penyambungan ulang (fusion splice) atau ukur dengan OTDR.",
      ],
    };
  }

  if (layer === "mikrotik") {
    return {
      title: "Konfigurasi & Sesi Router MikroTik",
      steps: [
        "Cek limitasi di /queue/simple: pastikan paket pelanggan tidak dibuang (dropped) karena mencapai batas max-limit.",
        "Tinjau sesi PPPoE di /ppp/active: verifikasi stabilitas uptime dan pastikan sesi tidak flapping.",
        "Verifikasi tabel ARP (/ip/arp) dan DHCP lease untuk memastikan tidak terjadi bentrok alamat IP.",
      ],
    };
  }

  if (layer === "hulu") {
    return {
      title: "Jalur Uplink & Internet Global",
      steps: [
        "Periksa status fisik port uplink dan negosiasi kecepatan antarmuka router Core (/interface).",
        "Verifikasi default route di /ip/route dan pastikan session BGP peer dalam kondisi Established.",
        "Jangan kirim teknisi ke pelanggan; eskalasi ke penyedia upstream / transit jika link down dari ISP.",
      ],
    };
  }

  if (layer === "firewall") {
    return {
      title: "Aturan Firewall & Isolir",
      steps: [
        "Periksa /ip/firewall/address-list: pastikan IP pelanggan tidak masuk ke daftar isolir atau blokir.",
        "Tinjau hit rule filter drop atau raw yang mencocokkan IP pelanggan pada tabel firewall.",
        "Verifikasi kapasitas connection tracking router jika terjadi penurunan throughput global.",
      ],
    };
  }

  if (layer === "ont") {
    return {
      title: "Modem / ONT Pelanggan",
      steps: [
        "Pastikan perangkat modem pelanggan dalam kondisi hidup dan terhubung ke catu daya yang stabil.",
        "Verifikasi parameter CWMP/TR-069 dan komunikasi ke server GenieACS.",
        "Jika modem tidak merespons, jadwalkan pengecekan perangkat fisik ONT di lokasi pelanggan.",
      ],
    };
  }

  if (layer === "trafik") {
    return {
      title: "Analisis Trafik & Bandwidth",
      steps: [
        "Periksa utilisasi bandwidth pelanggan terhadap paket langganan di grafik pemakaian.",
        "Tinjau host lawan dan port dominan di NetFlow untuk mendeteksi indikasi flooding atau DDoS.",
        "Informasikan kepada pelanggan jika kuota FUP telah tercapai atau paket langganan memerlukan upgrade.",
      ],
    };
  }

  if (layer === "billing") {
    return {
      title: "Status Billing & Tagihan",
      steps: [
        "Verifikasi status tagihan dan pembayaran pelanggan pada sistem billing.",
        "Jika pelanggan telah membayar, lakukan sinkronisasi pelepasan isolir ke router.",
      ],
    };
  }

  if (layer === "log") {
    return {
      title: "Riwayat Log Router",
      steps: [
        "Periksa rekaman log MikroTik (/log) pada jendela waktu keluhan untuk mengetahui penyebab diskoneksi.",
        "Pastikan tidak terjadi penolakan autentikasi (auth failed) atau kegagalan alokasi IP.",
      ],
    };
  }

  return {
    title: "Kondisi Operasional Normal",
    steps: [
      "Semua parameter jaringan terpantau dalam batas normal.",
      "Tidak diperlukan tindakan perbaikan fisik ke lokasi pelanggan.",
    ],
  };
}

export function VerdictConclusion({ run }: { run: DiagnosticRunDto }) {
  const scope = run.verdictScope ?? (run.isSharedFault ? "shared" : null);
  const isShared = scope === "shared";
  const isHulu =
    run.verdictLayer === "hulu" || run.verdictRoot?.kind === "uplink";
  const isSharedByEvidence =
    isShared &&
    (run.verdictRoot?.kind === "router" ||
      run.verdictRoot?.kind === "odp" ||
      !isHulu);
  const LayerIcon = run.verdictLayer
    ? layerIcons[run.verdictLayer as DiagnosticLayer]
    : null;
  const actionPlan = getActionPlan(run);

  return (
    <div className="flex flex-col gap-2.5 text-xs">
      {/* Header bar: Scope badge, Layer, Source, Origin, Time */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-border/50">
        <div className="flex flex-wrap items-center gap-1.5">
          {scope && (
            <Badge
              variant={
                scope === "shared"
                  ? "destructive"
                  : scope === "unknown"
                    ? "secondary"
                    : "outline"
              }
              className={
                scope === "shared"
                  ? "border-destructive/40 bg-destructive/15 text-destructive font-semibold text-[11px]"
                  : "text-[11px] font-medium"
              }
              data-testid="verdict-scope"
            >
              {scopeBadgeLabels[scope]}
            </Badge>
          )}
          {LayerIcon && (
            <span className="inline-flex items-center gap-1 font-semibold text-foreground text-xs px-2 py-0.5 rounded-md bg-muted/60 border border-border/40">
              <LayerIcon aria-hidden="true" className="size-3.5 text-primary shrink-0" />
              {layerLabel(run.verdictLayer!)}
            </span>
          )}
          {(() => {
            const vInfo = run.verdictLayer ? layerInfo(run.verdictLayer) : null;
            const vMk = vInfo ? mikrotikSources(vInfo) : [];
            const primary = vMk[0] ?? vInfo?.sources[0];
            if (!primary) return null;
            return (
              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted/80 text-foreground border border-border/60 inline-flex items-center gap-1 font-medium">
                <span>{primary.system === "MikroTik" ? "MikroTik" : primary.system}</span>
                <span>{primary.path}</span>
              </span>
            );
          })()}
          <RunOrigin run={run} />
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {formatWhen(run.finishedAt ?? run.createdAt)}
        </span>
      </div>

      {/* 2-column Executive Overview: Masalah Utama vs Cara Resolve */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        {/* Kolom 1: Masalah Utama */}
        <div className="flex flex-col gap-2 rounded-lg border border-border/80 bg-card p-3 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <span
                className={cn(
                  "size-2 rounded-full shrink-0",
                  run.verdictLayer || isShared
                    ? "bg-rose-500 animate-pulse"
                    : "bg-emerald-500",
                )}
              />
              <span>Masalah Utama</span>
            </div>
            {run.verdictLayer && (
              <span className="text-[11px] font-medium text-rose-500 dark:text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                {layerLabel(run.verdictLayer)}
              </span>
            )}
          </div>

          <div className="text-xs text-foreground leading-relaxed">
            <span className="font-semibold">
              Kesimpulan
              {run.verdictLayer ? `: ${layerLabel(run.verdictLayer)}` : ""}.
            </span>{" "}
            {run.verdictDetail}
          </div>

          {isShared && (
            <div className="mt-1 space-y-1 rounded-md bg-destructive/10 border border-destructive/25 p-2.5 text-xs">
              {run.verdictRoot && (
                <p
                  className="font-medium text-destructive"
                  data-testid="verdict-root"
                >
                  Sumber: {run.verdictRoot.name} — {run.verdictRoot.affected} dari{" "}
                  {run.verdictRoot.served} pelanggan terganggu
                </p>
              )}
              {isHulu && (
                <span className="block font-medium text-foreground">
                  Gangguan bersama di sisi hulu: bukan masalah perangkat pelanggan.
                </span>
              )}
              {isSharedByEvidence && (
                <span className="block font-semibold text-destructive">
                  Jangan kirim teknisi ke rumah pelanggan sebelum sumber bersama
                  diperiksa.
                </span>
              )}
            </div>
          )}

          {run.verdictHeld && (
            <p
              className="text-[11px] text-muted-foreground italic mt-0.5"
              data-testid="verdict-held"
            >
              Dipertahankan dari diagnosa sebelumnya (anti-flapping)
            </p>
          )}
        </div>

        {/* Kolom 2: Cara Resolve / Rekomendasi Tindakan */}
        <div className="flex flex-col gap-2 rounded-lg border border-border/80 bg-card p-3 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Wrench className="size-3.5 text-primary shrink-0" />
              <span>Cara Resolve &amp; Rekomendasi Tindakan</span>
            </div>
            <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Action Plan
            </span>
          </div>

          <div className="flex flex-col gap-1.5 text-xs">
            <p className="text-[11px] font-medium text-foreground">
              {actionPlan.title}:
            </p>
            <ol className="flex flex-col gap-1.5 list-none m-0 p-0 text-muted-foreground">
              {actionPlan.steps.map((step, idx) => (
                <li key={idx} className="flex items-start gap-2 leading-relaxed">
                  <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary font-bold text-[10px] mt-0.5">
                    {idx + 1}
                  </span>
                  <span className="text-foreground/90">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* Temuan Terkait */}
      {run.verdictSecondary && run.verdictSecondary.length > 0 && (
        <div className="rounded-lg border border-border/70 bg-card/60 p-2.5" data-testid="verdict-secondary">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-foreground">
              Temuan terkait ({run.verdictSecondary.length})
            </h4>
            <span className="text-[10px] text-muted-foreground">
              Metrik lain di luar penyebab utama
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {run.verdictSecondary.map((s, idx) => (
              <div
                key={`${s.layer}-${s.label}-${idx}`}
                className="flex items-center justify-between gap-2 p-2 rounded-md border border-border/50 bg-muted/20"
              >
                <div className="min-w-0 flex flex-col gap-0.5">
                  <span className="font-medium text-foreground truncate">
                    {layerLabel(s.layer)}: {s.label}
                  </span>
                  {s.value !== null && (
                    <span className="font-mono text-[11px] text-muted-foreground tabular-nums truncate">
                      {s.value}
                      {s.threshold !== null && ` (ambang ${s.threshold})`}
                    </span>
                  )}
                </div>
                <FindingStatusPill status={s.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const statusOrder: Record<FindingStatus, number> = {
  fail: 4,
  warn: 3,
  unchecked: 2,
  ok: 1,
};

function getWorstStatus(findings: FindingDto[]): FindingStatus | null {
  if (!findings || findings.length === 0) return null;
  let worst: FindingStatus = "ok";
  for (const f of findings) {
    if (statusOrder[f.status] > statusOrder[worst]) {
      worst = f.status;
    }
  }
  return worst;
}

function getWorstFinding(findings: FindingDto[]): FindingDto | null {
  if (!findings || findings.length === 0) return null;
  let worst = findings[0];
  for (const f of findings) {
    if (statusOrder[f.status] > statusOrder[worst.status]) {
      worst = f;
    }
  }
  return worst;
}

function getLayerKeyFigure(layerId: string, findings: FindingDto[]): string | null {
  if (!findings || findings.length === 0) return null;
  if (layerId === "optik") {
    const rx = findings.find(
      (f) =>
        f.value !== null &&
        (f.metric === "optical_power" || f.value.toLowerCase().includes("dbm")),
    );
    if (rx?.value) return rx.value;
  }
  if (layerId === "hulu") {
    const h = findings.find(
      (f) =>
        f.value !== null &&
        (f.value.includes("%") ||
          f.value.toLowerCase().includes("ms") ||
          f.value.toLowerCase().includes("bps")),
    );
    if (h?.value) return h.value;
  }
  if (layerId === "trafik") {
    const tr = findings.find(
      (f) =>
        f.value !== null &&
        (f.value.toLowerCase().includes("bps") || f.value.includes("%")),
    );
    if (tr?.value) return tr.value;
  }
  if (layerId === "mikrotik") {
    const mk = findings.find(
      (f) =>
        f.value !== null &&
        (f.metric === "cpu" || f.value.includes("%")),
    );
    if (mk?.value) return mk.value;
  }
  return null;
}

export function DiagnosticRunView({ runId }: { runId: string }) {
  const { run, error } = useDiagnosticRun(runId);
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});
  const [openFindingInfos, setOpenFindingInfos] = useState<Record<string, boolean>>({});

  const toggleFindingInfo = (id: string) => {
    setOpenFindingInfos((prev) => ({ ...prev, [id]: !prev[id] }));
  };
  if (!run) {
    return (
      <div className="text-xs text-muted-foreground" role="status">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : (
          "Memuat diagnosa…"
        )}
      </div>
    );
  }

  const findings = run.findings ?? [];
  const byLayer = new Map<string, FindingDto[]>();
  for (const f of findings)
    byLayer.set(f.layer, [...(byLayer.get(f.layer) ?? []), f]);
  const layers = run.isSharedFault
    ? diagnosticLayers.filter((l) => byLayer.has(l.id))
    : diagnosticLayers;
  const active = isRunActive(run);

  const isLayerOpen = (layerId: string, list: FindingDto[] | undefined) => {
    if (manualOpen[layerId] !== undefined) {
      return manualOpen[layerId];
    }
    const worst = getWorstStatus(list ?? []);
    // auto-expanded for fail/warn layers, collapsed for ok/unchecked
    return worst === "fail" || worst === "warn";
  };

  const toggleLayer = (layerId: string, list: FindingDto[] | undefined) => {
    const current = isLayerOpen(layerId, list);
    setManualOpen((prev) => ({ ...prev, [layerId]: !current }));
  };

  const allOpen = layers.every((l) => isLayerOpen(l.id, byLayer.get(l.id)));

  const toggleAll = () => {
    const next = !allOpen;
    const update: Record<string, boolean> = {};
    for (const l of layers) {
      update[l.id] = next;
    }
    setManualOpen(update);
  };

  return (
    <div
      className="flex min-w-0 flex-col gap-3"
      data-testid="diagnostic-run"
      data-status={run.status}
    >
      {/* Top Customer / Run Info */}
      <div className="flex flex-col gap-1 border-b border-border/60 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-xs sm:text-sm text-foreground">
            {run.customerName ??
              (run.isSharedFault || run.verdictScope === "shared"
                ? "Gangguan bersama"
                : "Pelanggan terhapus")}
          </span>
          {run.pppoeUsername && (
            <span className="font-mono text-xs text-muted-foreground">
              {run.pppoeUsername}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RunOrigin run={run} />
          <span className="text-[11px] text-muted-foreground">
            Keluhan {formatWhen(run.complaintAt ?? run.createdAt)} · diminta{" "}
            {formatWhen(run.createdAt)} · mulai {formatWhen(run.startedAt)} ·
            selesai {formatWhen(run.finishedAt)}
          </span>
        </div>
      </div>

      {/* Conclusion / Progress Status Box */}
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "rounded-lg border p-2.5 sm:p-3 text-xs leading-normal",
          run.status === "failed" &&
            "border-destructive/40 bg-destructive/10 text-destructive",
          run.status === "done" &&
            (run.verdictLayer ||
              run.verdictScope === "shared" ||
              run.isSharedFault)
            ? "border-destructive/30 bg-destructive/5"
            : "border-border bg-card/70",
        )}
      >
        {run.status === "queued" && (
          <span className="inline-flex items-center gap-2 text-foreground">
            <Loader2 aria-hidden="true" className="size-4 animate-spin text-primary motion-reduce:animate-none" />
            Menunggu antrean pemeriksaan router…
          </span>
        )}
        {run.status === "running" && (
          <span className="inline-flex items-center gap-2 text-foreground">
            <Loader2 aria-hidden="true" className="size-4 animate-spin text-primary motion-reduce:animate-none" />
            Memeriksa lapisan{" "}
            {Math.min(byLayer.size + 1, diagnosticLayers.length)} dari{" "}
            {diagnosticLayers.length}…
          </span>
        )}
        {run.status === "failed" && (
          <>Diagnosa gagal: {run.error ?? "alasan tidak diketahui"}</>
        )}
        {run.status === "done" && <VerdictConclusion run={run} />}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Layers Header & Global Toggle */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
        <span className="text-xs font-semibold text-foreground">
          Lapisan Pemeriksaan ({layers.length})
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={toggleAll}
        >
          {allOpen ? "Tutup semua" : "Buka semua"}
        </Button>
      </div>

      {/* Dense Accordion per Layer */}
      <ol className="flex flex-col gap-2">
        {layers.map((layer, i) => {
          const list = byLayer.get(layer.id);
          const LayerIcon =
            layerIcons[layer.id as DiagnosticLayer] ?? AlertTriangle;
          const lInfo = layerInfo(layer.id);
          const lMkSources = mikrotikSources(lInfo);
          const primaryLayerSource = lMkSources[0] ?? lInfo.sources[0];
          const worstStatus = list ? getWorstStatus(list) : null;
          const worstFinding = list ? getWorstFinding(list) : null;
          const keyFigure = list ? getLayerKeyFigure(layer.id, list) : null;
          const isOpen = isLayerOpen(layer.id, list);

          return (
            <li
              key={layer.id}
              className="min-w-0 rounded-lg border border-border bg-card/60 transition-colors"
              data-testid="diagnostic-layer"
              data-layer={layer.id}
            >
              {/* Compact row */}
              <div className="flex flex-col gap-1 p-2 sm:p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <div className="flex items-center gap-1.5 font-medium text-foreground text-xs">
                      <LayerIcon
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                      <span>
                        {i + 1}. {layer.label}
                      </span>
                    </div>
                    {primaryLayerSource && (
                      <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground border border-border/40 max-w-full truncate font-medium">
                        {primaryLayerSource.system} {primaryLayerSource.path}
                      </span>
                    )}
                    {keyFigure && (
                      <span className="font-mono text-[11px] font-medium px-1.5 py-0.5 rounded bg-muted text-foreground tabular-nums">
                        {keyFigure}
                      </span>
                    )}
                    {worstStatus && <FindingStatusPill status={worstStatus} />}
                    {list && list.length > 0 && (
                      <span className="text-[11px] text-muted-foreground">
                        • {list.length} temuan
                      </span>
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                    aria-expanded={isOpen}
                    aria-controls={`layer-content-${layer.id}`}
                    aria-label={`Rincian lapisan ${layer.label}`}
                    onClick={() => toggleLayer(layer.id, list)}
                  >
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        "size-3.5 transition-transform duration-150 motion-reduce:transition-none",
                        isOpen && "rotate-180",
                      )}
                    />
                  </Button>
                </div>

                {/* One-line summary */}
                <div className="text-[11px] text-muted-foreground">
                  {worstStatus === "unchecked" ? (
                    <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
                      <span className="text-muted-foreground/90">
                        tidak dapat diperiksa{worstFinding?.detail ? `: ${worstFinding.detail}` : ""}
                      </span>
                      {lInfo.sources.length > 0 && (
                        <span className="font-mono text-[10px] text-muted-foreground/70">
                          (sumber: {lInfo.sources.map((s) => `${s.system} ${s.path}`).join(", ")})
                        </span>
                      )}
                    </div>
                  ) : worstFinding &&
                    (worstStatus === "fail" || worstStatus === "warn") ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          "font-semibold",
                          worstStatus === "fail"
                            ? "text-destructive"
                            : "text-amber-500 dark:text-amber-400",
                        )}
                      >
                        {worstFinding.label}:
                      </span>
                      <span className="font-mono font-medium text-foreground">
                        {worstFinding.value ?? worstFinding.detail}
                      </span>
                      {worstFinding.threshold && (
                        <span className="text-muted-foreground text-[10px] font-mono">
                          (ambang: {worstFinding.comparator} {worstFinding.threshold})
                        </span>
                      )}
                      {worstFinding.detail && worstFinding.value && (
                        <span className="text-muted-foreground/80 truncate max-w-md">
                          · {worstFinding.detail}
                        </span>
                      )}
                    </div>
                  ) : worstStatus === "ok" ? (
                    <div className="flex items-center gap-1 text-muted-foreground/90 truncate" title={lInfo.explain}>
                      <span className="text-emerald-500 font-medium">✓</span>
                      <span className="font-medium text-foreground/85">Semua metrik dalam batas normal</span>
                      <span className="text-muted-foreground/60 hidden sm:inline">· {lInfo.explain}</span>
                    </div>
                  ) : (
                    <span>
                      {active
                        ? "Menunggu giliran…"
                        : "Tidak dapat diperiksa: belum ada temuan tercatat untuk lapisan ini."}
                    </span>
                  )}
                </div>
              </div>

              {/* Expanded finding table */}
              {isOpen && list && list.length > 0 && (
                <div
                  id={`layer-content-${layer.id}`}
                  className="border-t border-border/60 bg-muted/10 p-2 sm:p-2.5 space-y-2"
                >
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <caption className="sr-only">
                        Rincian temuan lapisan {layer.label}
                      </caption>
                      <thead className="border-b border-border/40 text-[11px] text-muted-foreground">
                        <tr>
                          <th scope="col" className="py-1 pr-2 font-medium">Metrik</th>
                          <th scope="col" className="py-1 px-2 font-medium">Nilai</th>
                          <th scope="col" className="py-1 px-2 font-medium">Ambang</th>
                          <th scope="col" className="py-1 px-2 font-medium">Status</th>
                          <th scope="col" className="py-1 pl-2 text-left font-medium">Sumber & Waktu</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30">
                        {list.map((f) => {
                          const fInfo = metricInfo(f.layer, f.metric);
                          const fMkSources = mikrotikSources(fInfo);
                          const primaryMk = fMkSources[0];
                          const isInfoOpen = !!openFindingInfos[f.id];

                          return (
                            <React.Fragment key={f.id}>
                              <tr
                                data-testid="diagnostic-finding"
                                data-status={f.status}
                                className="align-top hover:bg-muted/30 transition-colors"
                              >
                                <td className="py-2 pr-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-medium text-foreground">{f.label}</span>
                                    {primaryMk && (
                                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted/80 text-foreground border border-border/60 font-semibold whitespace-nowrap">
                                        MikroTik {primaryMk.path}
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      aria-expanded={isInfoOpen}
                                      aria-controls={`finding-info-${f.id}`}
                                      data-testid="finding-info"
                                      onClick={() => toggleFindingInfo(f.id)}
                                      className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline cursor-pointer"
                                      aria-label={`Apa ini: ${f.label}`}
                                    >
                                      <Info aria-hidden="true" className="size-2.5" />
                                      <span>Apa ini?</span>
                                    </button>
                                  </div>
                                  {f.detail && (
                                    <p className="text-[11px] text-muted-foreground/85 leading-normal mt-0.5 max-w-xl">
                                      {f.detail}
                                    </p>
                                  )}
                                </td>
                                <td className="py-2 px-2 font-mono tabular-nums text-foreground">
                                  {f.value ?? "—"}
                                </td>
                                <td className="py-2 px-2 font-mono tabular-nums text-muted-foreground">
                                  {[f.comparator, f.threshold].filter(Boolean).join(" ") || "—"}
                                </td>
                                <td className="py-2 px-2">
                                  <FindingStatusPill status={f.status} />
                                </td>
                                <td className="py-2 pl-2 text-left text-[11px] text-muted-foreground max-w-56 min-w-36 [overflow-wrap:anywhere]">
                                  {f.sourceRef ? (
                                    <span>
                                      <span className="font-semibold text-foreground">
                                        Dibaca dari:
                                      </span>{" "}
                                      {f.sourceRef}
                                    </span>
                                  ) : (
                                    "—"
                                  )}
                                  {f.sampledAt && ` · ${formatWhen(f.sampledAt)}`}
                                </td>
                              </tr>
                              {/* Info disclosure panel */}
                              {isInfoOpen && (
                                <tr
                                  id={`finding-info-${f.id}`}
                                  className="bg-muted/30 border-b border-border/40"
                                >
                                  <td colSpan={5} className="p-2.5 space-y-2 text-xs">
                                    <div className="flex flex-col gap-1">
                                      <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">
                                        Penjelasan Metrik: {fInfo.title || f.label}
                                      </span>
                                      <p className="text-xs text-foreground leading-relaxed">
                                        {fInfo.explain}
                                      </p>
                                    </div>

                                    {fInfo.sources.length > 0 && (
                                      <div className="space-y-1.5 pt-1.5 border-t border-border/40">
                                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                                          Sumber Data:
                                        </span>
                                        <ul className="flex flex-col gap-1">
                                          {fInfo.sources.map((s, idx) => {
                                            const isMk = s.system === "MikroTik";
                                            return (
                                              <li
                                                key={idx}
                                                className="flex flex-wrap items-center gap-1.5 text-xs bg-card p-1.5 rounded border border-border/50"
                                              >
                                                <Badge
                                                  variant={isMk ? "default" : "secondary"}
                                                  className="text-[10px] px-1.5 py-0 font-medium"
                                                >
                                                  {s.system}
                                                </Badge>
                                                {isMk ? (
                                                  <span className="font-bold text-foreground font-mono text-[11px]">
                                                    Sumber MikroTik: {s.path}
                                                  </span>
                                                ) : (
                                                  <span className="font-mono text-[11px] text-foreground font-medium">
                                                    {s.path}
                                                  </span>
                                                )}
                                                <span className="text-[11px] text-muted-foreground">
                                                  via {s.via}
                                                </span>
                                                {s.fields && s.fields.length > 0 && (
                                                  <span className="text-[11px] text-muted-foreground font-mono">
                                                    (field: {s.fields.join(", ")})
                                                  </span>
                                                )}
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      </div>
                                    )}

                                    {(f.sourceRef || f.sampledAt) && (
                                      <div className="text-[11px] text-muted-foreground pt-1 border-t border-border/30">
                                        <span className="font-semibold text-foreground">
                                          Dibaca dari:
                                        </span>{" "}
                                        {f.sourceRef ?? "—"}
                                        {f.sampledAt && ` · sampel ${formatWhen(f.sampledAt)}`}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {layer.id === "trafik" && run.customerId && (
                    <a
                      href={`/app/pelanggan/${run.customerId}`}
                      className="inline-block text-xs text-primary underline-offset-4 hover:underline"
                    >
                      Lihat grafik trafik pelanggan
                    </a>
                  )}
                  {layer.id === "firewall" && !!run.firewallRules?.length && (
                    <FirewallRuleTable rules={run.firewallRules} />
                  )}
                  {lInfo.sources.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground pt-1.5 border-t border-border/40">
                      <span className="font-semibold text-foreground">Sumber lapisan:</span>
                      {lInfo.sources.map((s, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 font-mono text-[11px] bg-muted/50 px-1.5 py-0.5 rounded border border-border/40 text-foreground"
                        >
                          <span className="font-semibold">{s.system}</span>
                          <span>{s.path}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {!active && !run.isSharedFault && <Timeline run={run} />}
    </div>
  );
}
