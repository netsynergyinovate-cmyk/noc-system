"use client";

import { AlertTriangle, Cable } from "lucide-react";
import { DeviceBadge } from "./device-badge";
import {
  CONNECTOR_DB,
  FIBER_DB_PER_KM,
  OLT_TX_DBM,
  RX_IDEAL,
  SPLICE_DB,
  type BudgetStep,
  type lossBudget,
} from "@/services/map/loss-budget";

// Ikon tiap langkah: perangkat memakai lencana yang sama dengan penanda peta
function StepIcon({ step }: { step: BudgetStep }) {
  if (step.kind === "fiber") {
    return (
      <span aria-hidden className="w-5 h-5 rounded-md inline-flex items-center justify-center bg-sky-500 text-white shadow-sm">
        <Cable className="w-3 h-3" strokeWidth={2.25} />
      </span>
    );
  }
  if (step.kind === "onu") return <DeviceBadge type="customer" color="#10b981" />;
  return <DeviceBadge type={step.deviceType ?? "server"} />;
}

// Skala bar daya: +5 dBm (penuh) sampai -30 dBm (kosong)
const barWidth = (dbm: number) => `${Math.min(100, Math.max(2, ((dbm + 30) / 35) * 100))}%`;
const rxTone = (dbm: number) =>
  dbm > RX_IDEAL.max ? "text-amber-500" : dbm >= RX_IDEAL.min ? "text-emerald-500" : "text-rose-500";

interface LossBudgetViewProps {
  budget: ReturnType<typeof lossBudget>;
  /** Judul daya akhir, mis. "Perkiraan Rx ONU" atau "Perkiraan daya di port output ODP" */
  resultLabel: string;
  /** Rx terukur dari ONU, untuk dibandingkan dengan perkiraan */
  measuredRx?: number | null;
}

// Rantai redaman dari OLT ke ujung: tiap langkah menampilkan redaman dan daya sisanya
export function LossBudgetView({ budget, resultLabel, measuredRx }: LossBudgetViewProps) {
  const diff = measuredRx != null ? measuredRx - budget.rxDbm : null;
  return (
    <div className="space-y-2">
      <ol className="relative space-y-1.5 before:absolute before:left-[9.5px] before:top-3 before:bottom-3 before:w-px before:bg-border">
        {budget.steps.map((s, i) => (
          <li key={i} className="relative pl-7">
            <span className="absolute left-0 top-0 ring-2 ring-card rounded-md">
              <StepIcon step={s} />
            </span>
            <div className="flex justify-between gap-2">
              <span className="font-medium text-foreground truncate">{s.label}</span>
              <span className="font-mono shrink-0">
                <span className="text-rose-500">−{s.lossDb.toFixed(2)} dB</span>
                <span className="text-muted-foreground"> → </span>
                <span className="text-foreground">{s.powerDbm.toFixed(2)} dBm</span>
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground">{s.detail}</div>
            <div className="h-1 mt-0.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500" style={{ width: barWidth(s.powerDbm) }} />
            </div>
            {s.warn && (
              <div className="flex items-center gap-1 text-[10px] text-amber-500">
                <AlertTriangle className="w-3 h-3" /> {s.warn}
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded-lg bg-background border border-border">
          <div className="text-[10px] text-muted-foreground">Total redaman</div>
          <div className="font-mono font-bold text-foreground">{budget.totalLossDb.toFixed(2)} dB</div>
        </div>
        <div className="p-2 rounded-lg bg-background border border-border">
          <div className="text-[10px] text-muted-foreground">{resultLabel}</div>
          {/* Rentang sehat hanya berlaku untuk Rx ONU, bukan daya di port ODC/ODP */}
          <div
            className={`font-mono font-bold ${budget.steps.at(-1)?.kind === "onu" ? rxTone(budget.rxDbm) : "text-foreground"}`}
          >
            {budget.rxDbm.toFixed(2)} dBm
          </div>
        </div>
        {measuredRx != null && diff != null && (
          <div className="col-span-2 p-2 rounded-lg bg-background border border-border flex justify-between gap-2">
            <span className="text-muted-foreground">Rx terukur ONU</span>
            <span className="font-mono">
              <b className={rxTone(measuredRx)}>{measuredRx.toFixed(2)} dBm</b>
              <span className={Math.abs(diff) > 3 ? " text-rose-500" : " text-muted-foreground"}>
                {" "}
                ({diff >= 0 ? "+" : ""}
                {diff.toFixed(2)} dB dari perkiraan)
              </span>
            </span>
          </div>
        )}
      </div>
      {diff != null && Math.abs(diff) > 3 && (
        <p className="text-[11px] text-rose-500">
          Selisih lebih dari 3 dB: cek sambungan/konektor kotor, tekukan kabel, atau rasio splitter yang tercatat.
        </p>
      )}
      {!budget.complete && (
        <p className="text-[11px] text-amber-500">Hitungan belum lengkap, lihat tanda peringatan di atas.</p>
      )}
      <p className="text-[10px] text-muted-foreground">
        Asumsi: Tx OLT +{OLT_TX_DBM} dBm, serat {FIBER_DB_PER_KM} dB/km, konektor {CONNECTOR_DB} dB, sambungan{" "}
        {SPLICE_DB} dB. Rx ONU sehat {RX_IDEAL.max} s/d {RX_IDEAL.min} dBm.
      </p>
    </div>
  );
}
