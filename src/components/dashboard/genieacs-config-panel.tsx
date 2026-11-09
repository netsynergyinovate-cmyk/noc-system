"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Server,
  Router,
  Info,
} from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CpeDevice } from "@/lib/dashboard/cpe";
import { formatAgo } from "@/lib/dashboard/customer-live";
import { summarizeFleet } from "@/lib/dashboard/genieacs-fleet";

export interface GenieacsConfigView {
  mode: "real" | "simulator";
  nbiUrl: string;
  acsConfigured: boolean;
  acsUrl: string;
  informInterval: number | null;
}

export interface NbiStatusView {
  ok: boolean;
  latencyMs?: number;
  deviceCount?: number;
  message?: string;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{children}</dd>
    </div>
  );
}

/** Konfigurasi GenieACS yang benar-benar berlaku, dibaca dari server dan dari modem; tidak ada teks tetap. */
export function GenieacsConfigPanel({
  config,
  configError,
  nbi,
  devices,
  nowSec,
}: {
  config: GenieacsConfigView | null;
  configError: boolean;
  nbi: NbiStatusView | null;
  devices: readonly CpeDevice[];
  nowSec: number;
}) {
  const [copied, setCopied] = useState(false);
  const fleet = useMemo(
    () => summarizeFleet(devices, config?.acsUrl ?? "", nowSec),
    [devices, config?.acsUrl, nowSec],
  );

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard ditolak peramban: teks tetap bisa disalin manual
    }
  }

  return (
    <div className="space-y-4" data-testid="genieacs-config">
      {fleet.findings.length > 0 && (
        <div
          role="status"
          className="space-y-1.5 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning"
        >
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" aria-hidden /> Yang menjelaskan
            status “tidak melapor”
          </p>
          <ul className="list-disc space-y-1 pl-6">
            {fleet.findings.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Server className="size-4 text-primary" aria-hidden /> Server
              GenieACS
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <Row label="Mode">
                {config
                  ? config.mode === "real"
                    ? "GenieACS nyata"
                    : "Simulator"
                  : "—"}
              </Row>
              <Row label="Alamat NBI (dipakai aplikasi)">
                <span className="font-mono text-xs">
                  {config?.nbiUrl ?? "—"}
                </span>
              </Row>
              <Row label="Koneksi NBI">
                {nbi === null ? (
                  "Memeriksa…"
                ) : nbi.ok ? (
                  <span className="text-success">
                    Terhubung{nbi.latencyMs ? ` · ${nbi.latencyMs} ms` : ""}
                  </span>
                ) : (
                  <span className="text-destructive">
                    {nbi.message ?? "Tidak terhubung"}
                  </span>
                )}
              </Row>
              <Row label="Modem terdaftar">{fleet.total}</Row>
              <Row label="Melapor (15 menit terakhir)">
                <span
                  className={
                    fleet.reporting > 0 ? "text-success" : "text-warning"
                  }
                >
                  {fleet.reporting}
                </span>
              </Row>
              <Row label="Inform terbaru">
                {fleet.newestInformAt
                  ? formatAgo(nowSec - fleet.newestInformAt)
                  : "—"}
              </Row>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Router className="size-4 text-primary" aria-hidden /> ACS yang
              harus dituju modem
            </CardTitle>
          </CardHeader>
          <CardContent>
            {config?.acsConfigured ? (
              <dl className="divide-y">
                <Row label="ACS URL">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-mono text-xs">{config.acsUrl}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label="Salin ACS URL"
                      onClick={() => void copy(config.acsUrl)}
                    >
                      {copied ? (
                        <Check className="size-3.5 text-success" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </Button>
                  </span>
                </Row>
                <Row label="Periodic inform">
                  {config.informInterval
                    ? `${config.informInterval} detik`
                    : "—"}
                </Row>
              </dl>
            ) : (
              <p className="flex items-start gap-2 py-2 text-sm text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                {configError
                  ? "Konfigurasi tidak bisa dimuat dari server."
                  : 'ACS URL belum diatur. Isi di Pengaturan "Pasang GenieACS" (butuh admin) supaya modem bisa dicek sudah mengarah ke server yang benar.'}
              </p>
            )}
            <p className="pt-2 text-xs text-muted-foreground">
              Atur di modem: menu TR-069 (ACS URL + Periodic Inform), atau lewat
              tombol Pasang GenieACS / profil TR-069 di OLT.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm">
            Modem menurut ACS yang mereka tuju
          </CardTitle>
        </CardHeader>
        <CardContent>
          {fleet.groups.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              Belum ada modem terdaftar.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">ACS di modem</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Modem</th>
                  <th className="py-1.5 pr-3 text-right font-medium">
                    Melapor
                  </th>
                  <th className="py-1.5 font-medium">Kesesuaian</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {fleet.groups.map((g) => (
                  <tr key={g.url || "(kosong)"}>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {g.url || "(tidak dilaporkan)"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {g.count}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {g.reporting}
                    </td>
                    <td className="py-2">
                      {g.matchesConfigured === null ? (
                        <span className="text-xs text-muted-foreground">
                          ACS belum diatur
                        </span>
                      ) : (
                        <Badge
                          variant="outline"
                          className={cn(
                            "gap-1 text-[10px]",
                            g.matchesConfigured
                              ? "border-success/40 text-success"
                              : "border-warning/40 text-warning",
                          )}
                        >
                          {g.matchesConfigured ? (
                            <CheckCircle2 className="size-3" aria-hidden />
                          ) : (
                            <AlertTriangle className="size-3" aria-hidden />
                          )}
                          {g.matchesConfigured ? "Sesuai" : "ACS lain"}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {fleet.intervals.length > 0 && (
            <p className="pt-3 text-xs text-muted-foreground">
              Periodic inform di modem:{" "}
              {fleet.intervals
                .map(
                  (i) =>
                    `${i.sec ? `${i.sec} dtk` : "tidak dilaporkan"} (${i.count} modem)`,
                )
                .join(" · ")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
