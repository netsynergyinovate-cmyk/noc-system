"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCanDo } from "@/components/access";
import { cn } from "@/lib/utils";
import type { DiagnosticPolicyDto, DiagnosticRunDto } from "@/lib/diagnostics";
import { layerLabel } from "@/lib/diagnostics";
import { requestDiagnostic } from "./diagnose-button";
import {
  DiagnosticRunView,
  RunOrigin,
  errorMessage,
  formatWhen,
  isRunActive,
} from "./diagnostic-run-view";

type CustomerOption = { id: string; name: string; pppoeUsername: string };

function CustomerPicker({
  selected,
  onSelect,
}: {
  selected: CustomerOption | null;
  onSelect: (c: CustomerOption) => void;
}) {
  const [customers, setCustomers] = useState<CustomerOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let stopped = false;
    fetch("/api/customers", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok)
          throw new Error(await errorMessage(res, "Gagal memuat pelanggan"));
        const { data } = (await res.json()) as { data: CustomerOption[] };
        if (!stopped) setCustomers(data);
      })
      .catch((e) => {
        if (!stopped)
          setError(e instanceof Error ? e.message : "Gagal memuat pelanggan.");
      });
    return () => {
      stopped = true;
    };
  }, []);

  const matches = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q || !customers) return [];
    return customers
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.pppoeUsername.toLowerCase().includes(q) ||
          c.id.toLowerCase() === q,
      )
      .slice(0, 8);
  }, [customers, query]);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="diagnostic-customer-search">
        Cari pelanggan (nama, ID, atau username PPPoE)
      </Label>
      <Input
        id="diagnostic-customer-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          customers ? `${customers.length} pelanggan` : "Memuat pelanggan…"
        }
        autoComplete="off"
      />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {query.trim() && customers && (
        <ul
          className="max-h-64 overflow-auto rounded-md border"
          aria-label="Hasil pencarian pelanggan"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              Tidak ada pelanggan yang cocok.
            </li>
          ) : (
            matches.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-muted",
                    selected?.id === c.id && "bg-muted",
                  )}
                  aria-pressed={selected?.id === c.id}
                  onClick={() => {
                    onSelect(c);
                    setQuery("");
                  }}
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {c.pppoeUsername}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function RunHistory({
  activeId,
  onOpen,
  refreshKey,
}: {
  activeId: string | null;
  onOpen: (id: string) => void;
  refreshKey: number;
}) {
  const [runs, setRuns] = useState<DiagnosticRunDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    async function load() {
      try {
        const res = await fetch("/api/anomalies/diagnostics?limit=20", {
          cache: "no-store",
        });
        if (!res.ok)
          throw new Error(
            await errorMessage(res, "Gagal memuat riwayat diagnosa"),
          );
        const { data } = (await res.json()) as { data: DiagnosticRunDto[] };
        if (!stopped) {
          setRuns(data);
          setError(null);
        }
      } catch (e) {
        if (!stopped)
          setError(
            e instanceof Error ? e.message : "Gagal memuat riwayat diagnosa.",
          );
      }
    }
    void load();
    const timer = setInterval(load, 10_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [refreshKey]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Riwayat diagnosa</CardTitle>
        <CardDescription>Manual dan otomatis, terbaru di atas.</CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="mb-2 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {!runs ? (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Belum ada diagnosa.</p>
        ) : (
          <ul
            className="flex flex-col divide-y"
            data-testid="diagnostic-history"
          >
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  aria-pressed={activeId === r.id}
                  className={cn(
                    "flex w-full flex-col items-start gap-1 py-2 text-left text-sm hover:bg-muted/60",
                    activeId === r.id && "bg-muted",
                  )}
                  onClick={() => onOpen(r.id)}
                >
                  <span className="font-medium">
                    {r.isSharedFault
                      ? "Gangguan bersama"
                      : (r.customerName ?? "Pelanggan terhapus")}
                  </span>
                  <RunOrigin run={r} />
                  <span className="text-xs text-muted-foreground">
                    {formatWhen(r.createdAt)} ·{" "}
                    {isRunActive(r)
                      ? "sedang berjalan"
                      : r.status === "failed"
                        ? "gagal"
                        : r.verdictLayer
                          ? `bermasalah: ${layerLabel(r.verdictLayer)}`
                          : r.isSharedFault
                            ? "diagnosa per pelanggan ditahan"
                            : "tidak ada lapisan bermasalah"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const policyFields = [
  {
    key: "dedupeMinutes",
    label: "Jendela anti-duplikat (menit)",
    min: 1,
    max: 1440,
  },
  {
    key: "massThreshold",
    label: "Ambang gangguan bersama (pelanggan)",
    min: 2,
    max: 1000,
  },
  {
    key: "massWindowMinutes",
    label: "Jendela gangguan bersama (menit)",
    min: 1,
    max: 60,
  },
] as const;

const triggerFields = [
  { key: "triggerAlert", label: "Alert pelanggan (offline, optik, antrean)" },
  { key: "triggerTicket", label: "Tiket keluhan" },
  { key: "triggerBilling", label: "Billing berubah menjadi isolir" },
] as const;

function PolicyCard() {
  const canManage = useCanDo("manageThresholds");
  const [policy, setPolicy] = useState<DiagnosticPolicyDto | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let stopped = false;
    fetch("/api/anomalies/diagnostics/policy", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok)
          throw new Error(await errorMessage(res, "Gagal memuat kebijakan"));
        const { data } = (await res.json()) as { data: DiagnosticPolicyDto };
        if (!stopped) setPolicy(data);
      })
      .catch((e) => {
        if (!stopped)
          setError(e instanceof Error ? e.message : "Gagal memuat kebijakan.");
      });
    return () => {
      stopped = true;
    };
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!policy || !canManage || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const {
        triggerAlert,
        triggerTicket,
        triggerBilling,
        dedupeMinutes,
        massThreshold,
        massWindowMinutes,
      } = policy;
      const res = await fetch("/api/anomalies/diagnostics/policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          triggerAlert,
          triggerTicket,
          triggerBilling,
          dedupeMinutes,
          massThreshold,
          massWindowMinutes,
        }),
      });
      if (!res.ok)
        throw new Error(await errorMessage(res, "Gagal menyimpan kebijakan"));
      setPolicy(((await res.json()) as { data: DiagnosticPolicyDto }).data);
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menyimpan kebijakan.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Pemicu otomatis</CardTitle>
        <CardDescription>
          Diagnosa otomatis tidak membuat alert atau tiket, dan selalu antre di
          belakang permintaan manual.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!policy ? (
          <p className="text-sm text-muted-foreground">{error ?? "Memuat…"}</p>
        ) : (
          <form
            className="flex flex-col gap-3 text-sm"
            onSubmit={(e) => void save(e)}
          >
            <fieldset className="flex flex-col gap-2" disabled={!canManage}>
              <legend className="mb-1 font-medium">
                Jalankan otomatis saat
              </legend>
              {triggerFields.map((f) => (
                <label key={f.key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={policy[f.key]}
                    onChange={(e) =>
                      setPolicy({ ...policy, [f.key]: e.target.checked })
                    }
                  />
                  {f.label}
                </label>
              ))}
            </fieldset>
            {policyFields.map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <Label htmlFor={`policy-${f.key}`}>{f.label}</Label>
                <Input
                  id={`policy-${f.key}`}
                  type="number"
                  min={f.min}
                  max={f.max}
                  required
                  disabled={!canManage}
                  value={policy[f.key]}
                  onChange={(e) =>
                    setPolicy({ ...policy, [f.key]: Number(e.target.value) })
                  }
                />
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Diubah terakhir {formatWhen(policy.updatedAt)} oleh{" "}
              {policy.updatedBy ?? "bawaan sistem"}.
            </p>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            {saved && (
              <p className="text-sm text-success" role="status">
                Kebijakan tersimpan.
              </p>
            )}
            {canManage ? (
              <Button type="submit" size="sm" aria-disabled={saving}>
                {saving ? "Menyimpan…" : "Simpan kebijakan"}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Hanya peran dengan izin ambang alert yang dapat mengubah.
              </p>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function DiagnosticPanel() {
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [reused, setReused] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // datetime-local (jam peramban); kosong = keluhan dianggap sekarang.
  const [complaintAt, setComplaintAt] = useState("");

  const open = useCallback((id: string) => {
    setRunId(id);
    setReused(false);
  }, []);

  async function start() {
    if (!customer) return;
    setStarting(true);
    setError(null);
    try {
      const when = complaintAt ? new Date(complaintAt) : null;
      if (when && Number.isNaN(when.getTime()))
        throw new Error("Waktu keluhan tidak valid.");
      const { data, reused } = await requestDiagnostic(
        customer.id,
        when?.toISOString(),
      );
      setRunId(data.id);
      setReused(reused);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memulai diagnosa.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <section
      aria-labelledby="diagnostic-heading"
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]"
    >
      <Card>
        <CardHeader className="pb-3">
          <CardTitle id="diagnostic-heading" className="text-base">
            Diagnosa pelanggan
          </CardTitle>
          <CardDescription>
            Pemeriksaan berlapis hulu ke hilir. Setiap temuan menampilkan angka,
            ambang, dan sumber datanya; lapisan yang belum bisa diperiksa
            ditandai, bukan dianggap normal.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CustomerPicker selected={customer} onSelect={setCustomer} />
          <div className="flex flex-col gap-1">
            <Label htmlFor="diagnostic-complaint-at">
              Waktu keluhan (opsional)
            </Label>
            <Input
              id="diagnostic-complaint-at"
              type="datetime-local"
              className="w-full sm:w-64"
              value={complaintAt}
              onChange={(e) => setComplaintAt(e.target.value)}
              aria-describedby="diagnostic-complaint-hint"
            />
            <p
              id="diagnostic-complaint-hint"
              className="text-xs text-muted-foreground"
            >
              Acuan garis waktu: kejadian log dan alert ditandai sebelum atau
              sesudah keluhan. Kosong = sekarang.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm">
              {customer ? (
                <>
                  Target: <span className="font-medium">{customer.name}</span>{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    {customer.pppoeUsername}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  Belum ada pelanggan dipilih.
                </span>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              aria-disabled={!customer}
              aria-busy={starting}
              data-testid="run-diagnostic"
              onClick={() => {
                if (!customer) setError("Pilih pelanggan dulu.");
                else void start();
              }}
            >
              <Stethoscope aria-hidden="true" className="size-3.5" />
              {starting ? "Memulai…" : "Jalankan diagnosa"}
            </Button>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {reused && (
            <p className="text-sm text-muted-foreground">
              Diagnosa manual pelanggan ini masih berjalan; yang tampil adalah
              pemeriksaan tersebut.
            </p>
          )}
          {runId && <DiagnosticRunView key={runId} runId={runId} />}
        </CardContent>
      </Card>
      <div className="flex flex-col gap-4">
        <RunHistory activeId={runId} onOpen={open} refreshKey={refreshKey} />
        <PolicyCard />
      </div>
    </section>
  );
}
