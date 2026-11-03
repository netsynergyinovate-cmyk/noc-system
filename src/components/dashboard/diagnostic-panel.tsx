"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { History, Settings2, Stethoscope, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCanDo } from "@/components/access";
import { cn } from "@/lib/utils";
import type { DiagnosticPolicyDto } from "@/lib/diagnostics";
import { requestDiagnostic } from "./diagnose-button";
import {
  DiagnosticRunView,
  errorMessage,
  formatWhen,
} from "./diagnostic-run-view";
import { DiagnosticHistory } from "./diagnostic-history";

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
        const json: unknown = await res.json();
        if (json && typeof json === "object" && "data" in json) {
          const parsed = json as { data: CustomerOption[] };
          if (!stopped) setCustomers(parsed.data);
        }
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
    <div className="relative flex flex-col gap-1">
      <Label htmlFor="diagnostic-customer-search" className="text-[11px] text-muted-foreground">
        Cari pelanggan
      </Label>
      <Input
        id="diagnostic-customer-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          customers
            ? `Nama, ID, atau username PPPoE · ${customers.length} pelanggan`
            : "Memuat pelanggan…"
        }
        autoComplete="off"
        className="h-8 text-xs"
      />
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {query.trim() && customers && (
        <ul
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-auto rounded-md border border-border bg-popover shadow-md text-xs"
          aria-label="Hasil pencarian pelanggan"
        >
          {matches.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              Tidak ada pelanggan yang cocok.
            </li>
          ) : (
            matches.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted/60",
                    selected?.id === c.id && "bg-muted font-medium",
                  )}
                  aria-pressed={selected?.id === c.id}
                  onClick={() => {
                    onSelect(c);
                    setQuery("");
                  }}
                >
                  <span className="font-medium text-foreground">{c.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
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

function PolicyForm() {
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
        const json: unknown = await res.json();
        if (json && typeof json === "object" && "data" in json) {
          const parsed = json as { data: DiagnosticPolicyDto };
          if (!stopped) setPolicy(parsed.data);
        }
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
      const json: unknown = await res.json();
      if (json && typeof json === "object" && "data" in json) {
        const parsed = json as { data: DiagnosticPolicyDto };
        setPolicy(parsed.data);
      }
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Gagal menyimpan kebijakan.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!policy) {
    return <p className="text-xs text-muted-foreground">{error ?? "Memuat…"}</p>;
  }
  return (
    <form className="flex flex-col gap-2.5 text-xs" onSubmit={(e) => void save(e)}>
      <fieldset className="flex flex-col gap-1.5" disabled={!canManage}>
        <legend className="mb-0.5 text-[11px] font-medium text-foreground">
          Jalankan otomatis saat:
        </legend>
        {triggerFields.map((f) => (
          <label key={f.key} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="size-3.5 rounded border-border"
              checked={policy[f.key]}
              onChange={(e) => setPolicy({ ...policy, [f.key]: e.target.checked })}
            />
            <span className="text-xs text-foreground">{f.label}</span>
          </label>
        ))}
      </fieldset>
      {policyFields.map((f) => (
        <div key={f.key} className="flex flex-col gap-0.5">
          <Label htmlFor={`policy-${f.key}`} className="text-[11px] text-muted-foreground">
            {f.label}
          </Label>
          <Input
            id={`policy-${f.key}`}
            type="number"
            min={f.min}
            max={f.max}
            required
            disabled={!canManage}
            value={policy[f.key]}
            onChange={(e) => setPolicy({ ...policy, [f.key]: Number(e.target.value) })}
            className="h-7 text-xs"
          />
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">
        Diubah {formatWhen(policy.updatedAt)} oleh {policy.updatedBy ?? "bawaan sistem"}.
      </p>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="text-xs text-success" role="status">
          Kebijakan tersimpan.
        </p>
      )}
      {canManage ? (
        <Button type="submit" size="sm" className="h-7 text-xs self-start" aria-disabled={saving}>
          {saving ? "Menyimpan…" : "Simpan kebijakan"}
        </Button>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Hanya peran dengan izin ambang alert yang dapat mengubah.
        </p>
      )}
    </form>
  );
}

export function DiagnosticPanel() {
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [reused, setReused] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // datetime-local (jam peramban); kosong = keluhan dianggap sekarang.
  const [complaintAt, setComplaintAt] = useState("");

  useEffect(() => {
    function handleOpenDiagnostic(e: Event) {
      if ("detail" in e && typeof e.detail === "object" && e.detail !== null && "runId" in e.detail) {
        const detail = e.detail as { runId?: string };
        if (detail.runId) {
          setRunId(detail.runId);
          setReused(false);
        }
      }
    }
    window.addEventListener("noc:open-diagnostic", handleOpenDiagnostic);
    return () => {
      window.removeEventListener("noc:open-diagnostic", handleOpenDiagnostic);
    };
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memulai diagnosa.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <section aria-label="Diagnosa pelanggan" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-card p-2">
        <div className="min-w-56 flex-1">
          <CustomerPicker selected={customer} onSelect={setCustomer} />
        </div>
        {customer && (
          <div className="flex items-center gap-1.5">
            <div className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 text-xs">
              <span className="font-medium text-foreground">{customer.name}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {customer.pppoeUsername}
              </span>
              <button
                type="button"
                onClick={() => setCustomer(null)}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Hapus pilihan pelanggan"
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            </div>
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" asChild>
              <Link href={`/app/pelanggan/${customer.id}#bukti`}>
                Bukti 3 hari
              </Link>
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="diagnostic-complaint-at"
            className="text-[11px] text-muted-foreground"
          >
            Waktu keluhan
          </Label>
          <Input
            id="diagnostic-complaint-at"
            type="datetime-local"
            className="h-8 w-auto text-xs py-0 px-2"
            value={complaintAt}
            onChange={(e) => setComplaintAt(e.target.value)}
            aria-describedby="diagnostic-complaint-hint"
          />
          <span id="diagnostic-complaint-hint" className="sr-only">
            Acuan garis waktu kejadian log dan alert. Kosong = sekarang.
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          aria-disabled={!customer}
          aria-busy={starting}
          data-testid="run-diagnostic"
          className="h-8 gap-1.5 text-xs font-medium"
          onClick={() => {
            if (!customer) setError("Pilih pelanggan dulu.");
            else void start();
          }}
        >
          <Stethoscope aria-hidden="true" className="size-3.5" />
          {starting ? "Memulai…" : "Diagnosa"}
        </Button>
        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" asChild>
          <Link href="/app/anomali/riwayat">
            <History aria-hidden="true" className="size-3.5" />
            Riwayat
          </Link>
        </Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
              <Settings2 aria-hidden="true" className="size-3.5" />
              Pemicu otomatis
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md p-4">
            <DialogHeader>
              <DialogTitle className="text-sm">Pemicu Otomatis</DialogTitle>
              <DialogDescription className="text-xs">
                Otomatis berjalan di antrean belakang manual.
              </DialogDescription>
            </DialogHeader>
            <PolicyForm />
          </DialogContent>
        </Dialog>
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {reused && (
        <p className="text-xs text-muted-foreground">
          Diagnosa manual pelanggan ini masih berjalan; yang tampil adalah
          pemeriksaan tersebut.
        </p>
      )}

      {runId && (
        <div className="rounded-lg border border-border bg-card p-3">
          <DiagnosticRunView key={runId} runId={runId} />
        </div>
      )}

      {customer && <DiagnosticHistory customerId={customer.id} />}
    </section>
  );
}
