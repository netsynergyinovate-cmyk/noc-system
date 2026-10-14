"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSessionUser } from "@/components/session-provider";
import { generateMockCpeDevices } from "@/lib/dashboard/cpe-mock";
import {
  cpeActionLabels,
  cpeStatusLabels,
  enqueueDiagnosticTask,
  getDiagnosticTasks,
  seedDiagnosticTasksIfEmpty,
  updateTaskStatus,
  type CpeDiagnosticAction,
  type CpeDiagnosticStatus,
  type CpeDiagnosticTask,
} from "@/lib/dashboard/cpe-diagnostics-logic";
import { useDashboardStore } from "@/lib/dashboard/store";
import { selectClassName } from "./select-class";

// Aksi yang boleh dijalankan dari form (reset pabrik sengaja tidak ditawarkan).
const formActions: CpeDiagnosticAction[] = ["ping_test", "traceroute", "reboot_device", "check_optical", "speed_test"];

const statusTone: Record<CpeDiagnosticStatus, string> = {
  pending: "border-border bg-secondary text-foreground",
  running: "border-warning/40 bg-warning/10 text-warning",
  success: "border-success/40 bg-success/10 text-success",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
};

const timeFormat = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  dateStyle: "medium",
  timeStyle: "medium",
});

function mockOutcome(
  action: CpeDiagnosticAction,
  params: Record<string, string | number | boolean>,
): { ok: boolean; resultSummary?: string; latencyMs?: number; errorReason?: string } {
  switch (action) {
    case "ping_test":
      return { ok: true, resultSummary: `4/4 paket diterima ke ${String(params.host)}, loss 0%`, latencyMs: 14 };
    case "traceroute":
      return { ok: true, resultSummary: `6 hop sampai ${String(params.host)}`, latencyMs: 23 };
    case "reboot_device":
      return { ok: true, resultSummary: `Reboot ${params.mode === "hard" ? "keras" : "lembut"} terkirim, modem menyala ulang` };
    case "check_optical":
      return { ok: true, resultSummary: "RX -23.6 dBm, TX 2.0 dBm (TR-069)" };
    case "speed_test":
      return { ok: true, resultSummary: "Down 47.5 Mbps / Up 20.1 Mbps", latencyMs: 17 };
    default:
      return { ok: false, errorReason: "Aksi tidak didukung" };
  }
}

export function CpeDiagnosticsPanel({ presetCustomerId }: { presetCustomerId?: string | null }) {
  const customers = useDashboardStore((s) => s.customers);
  const user = useSessionUser();
  const devices = useMemo(() => generateMockCpeDevices(customers), [customers]);
  const serialByCustomer = useMemo(() => new Map(devices.map((d) => [d.customerId, d.serialNumber])), [devices]);

  const [customerId, setCustomerId] = useState(presetCustomerId ?? "");
  const [action, setAction] = useState<CpeDiagnosticAction>("ping_test");
  const [host, setHost] = useState("8.8.8.8");
  const [rebootMode, setRebootMode] = useState<"soft" | "hard">("soft");
  const [tasks, setTasks] = useState<CpeDiagnosticTask[]>([]);
  const [detail, setDetail] = useState<CpeDiagnosticTask | null>(null);
  const [error, setError] = useState("");
  const timers = useRef<number[]>([]);

  const refresh = useCallback(() => setTasks(getDiagnosticTasks()), []);

  useEffect(() => {
    seedDiagnosticTasksIfEmpty();
    refresh();
    const t = timers.current;
    return () => t.forEach((id) => window.clearTimeout(id));
  }, [refresh]);

  const selected = customerId || customers[0]?.id || "";
  const inFlight = tasks.some((t) => t.status === "pending" || t.status === "running");
  const needsHost = action === "ping_test" || action === "traceroute";

  function run() {
    const customer = customers.find((c) => c.id === selected);
    if (!customer) {
      setError("Pilih pelanggan terlebih dahulu.");
      return;
    }
    const target = host.trim();
    if (needsHost && !/^[A-Za-z0-9.:-]{1,253}$/.test(target)) {
      setError("Host target tidak valid (hanya huruf, angka, titik, titik dua, strip).");
      return;
    }
    setError("");
    const parameters: Record<string, string | number | boolean> =
      needsHost ? { host: target } : action === "reboot_device" ? { mode: rebootMode } : {};
    const task = enqueueDiagnosticTask({
      customerId: customer.id,
      customerName: customer.name,
      deviceSerial: serialByCustomer.get(customer.id) ?? "-",
      action,
      parameters,
      initiatedBy: user?.name || user?.email || "Operator",
    });
    refresh();
    timers.current.push(
      window.setTimeout(() => {
        updateTaskStatus(task.id, "running");
        refresh();
      }, 300),
      window.setTimeout(() => {
        const o = mockOutcome(action, parameters);
        updateTaskStatus(task.id, o.ok ? "success" : "failed", o);
        refresh();
      }, 1500),
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="cpe-diagnostics-panel">
      <div
        data-testid="cpe-diag-mock-badge"
        className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium text-warning"
      >
        Tugas Diagnostik Tiruan (Fase 2) · Wajib beralih ke NBI GenieACS di Fase 5
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Jalankan Tugas Diagnostik Baru</CardTitle>
          <CardDescription>Pilih modem pelanggan dan jenis diagnostik.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            className="grid gap-4 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!inFlight) run();
            }}
          >
            <label className="flex flex-col gap-1.5 text-sm">
              Pelanggan / Modem CPE
              <select
                className={selectClassName}
                value={selected}
                onChange={(e) => setCustomerId(e.target.value)}
                data-testid="diag-customer"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.pppoeUsername})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              Aksi Diagnostik
              <select
                className={selectClassName}
                value={action}
                onChange={(e) => setAction(e.target.value as CpeDiagnosticAction)}
                data-testid="diag-action"
              >
                {formActions.map((a) => (
                  <option key={a} value={a}>
                    {cpeActionLabels[a]}
                  </option>
                ))}
              </select>
            </label>
            {needsHost && (
              <label className="flex flex-col gap-1.5 text-sm">
                Host Target
                <Input value={host} onChange={(e) => setHost(e.target.value)} className="font-mono" />
              </label>
            )}
            {action === "reboot_device" && (
              <label className="flex flex-col gap-1.5 text-sm">
                Mode Reboot
                <select
                  className={selectClassName}
                  value={rebootMode}
                  onChange={(e) => setRebootMode(e.target.value as "soft" | "hard")}
                >
                  <option value="soft">Lembut (soft reboot)</option>
                  <option value="hard">Keras (hard reboot)</option>
                </select>
              </label>
            )}
            <div className="flex flex-col gap-2 md:col-span-2">
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex items-center gap-3">
                <Button type="submit" data-testid="run-diag-btn" aria-disabled={inFlight}>
                  {inFlight ? <Loader2 className="mr-2 size-4 animate-spin" /> : <PlayCircle className="mr-2 size-4" />}
                  {inFlight ? "Menjalankan…" : "Jalankan Diagnostik"}
                </Button>
                {inFlight && <span className="text-xs text-muted-foreground">Satu tugas pada satu waktu.</span>}
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Riwayat Tugas Diagnostik CPE</CardTitle>
              <CardDescription>{tasks.length} tugas tercatat.</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={refresh} className="gap-1.5">
              <RefreshCw className="size-3.5" />
              Segarkan Riwayat
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Pelanggan</TableHead>
                  <TableHead>Aksi</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Hasil / Latensi</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead className="text-right">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      Belum ada tugas diagnostik.
                    </TableCell>
                  </TableRow>
                ) : (
                  tasks.map((t) => (
                    <TableRow key={t.id} data-testid="diag-task-row">
                      <TableCell className="text-xs text-muted-foreground">
                        <time dateTime={t.createdAt}>{timeFormat.format(new Date(t.createdAt))} WIB</time>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{t.customerName}</div>
                        <div className="font-mono text-xs text-muted-foreground">{t.deviceSerial}</div>
                      </TableCell>
                      <TableCell>{cpeActionLabels[t.action]}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusTone[t.status]}>
                          {cpeStatusLabels[t.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {t.resultSummary ?? t.errorReason ?? "—"}
                        {t.latencyMs != null && (
                          <span className="ml-2 text-xs tabular-nums text-muted-foreground">{t.latencyMs} ms</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{t.initiatedBy}</TableCell>
                      <TableCell className="text-right">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setDetail(t)}>
                          Lihat
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Rincian Output Diagnostik</DialogTitle>
            <DialogDescription>
              {detail ? `${cpeActionLabels[detail.action]} · ${detail.customerName}` : ""}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <pre className="max-h-72 overflow-auto rounded-md border bg-secondary/40 p-3 text-xs whitespace-pre-wrap">
              {[
                `ID: ${detail.id}`,
                `Serial: ${detail.deviceSerial}`,
                `Status: ${cpeStatusLabels[detail.status]}`,
                `Dibuat: ${detail.createdAt}`,
                `Selesai: ${detail.completedAt ?? "-"}`,
                `Operator: ${detail.initiatedBy}`,
                `Parameter: ${JSON.stringify(detail.parameters ?? {})}`,
                `Hasil: ${detail.resultSummary ?? "-"}`,
                `Latensi: ${detail.latencyMs != null ? `${detail.latencyMs} ms` : "-"}`,
                `Galat: ${detail.errorReason ?? "-"}`,
              ].join("\n")}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
