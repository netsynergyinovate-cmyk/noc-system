"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, ExternalLink, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "cn";

interface RunsnetOverview {
  availablePeriods: string[];
  customers: { total: number; active: number; isolir: number };
  invoices: { total: number; totalAmount: number; unpaidAmount: number; unpaidCount: number; paidCount: number };
  payments: { total: number; totalPaid: number };
  delinquentCustomersCount: number;
  lastSync: { startedAt: string; completedAt: string | null; status: string; errorMessage: string | null } | null;
}

interface CustomerItem {
  custId: string;
  name: string;
  serviceProfile: string | null;
  type: string | null;
  ipAddress: string | null;
  macAddress: string | null;
  ipSyncedAt: string | null;
  spkDate: string | null;
  connectivity: string | null;
  status: string;
}

interface InvoiceItem {
  invoiceCode: string;
  custId: string;
  custName: string;
  periode: string | null;
  dueDate: string | null;
  amount: number;
  remainingAmount: number;
  status: string;
  fileUrl: string | null;
}

interface PaymentItem {
  paymentCode: string;
  invoiceCode: string | null;
  custId: string;
  custName: string;
  payDate: string | null;
  amount: number;
  method: string | null;
  operator: string | null;
}

interface DelinquentItem {
  custId: string;
  custName: string;
  serviceProfile: string | null;
  status: string;
  connectivity: string | null;
  unpaidCount: number;
  totalDebt: number;
  oldestDueDate: string | null;
}

interface CustomerDetail {
  customer: CustomerItem | null;
  invoices: InvoiceItem[];
  payments: PaymentItem[];
}

// Info sesi layanan dari halaman detail RunsNet (IP, MAC, login terakhir, dst).
interface CustomerLive {
  ipAddress: string | null;
  macAddress: string | null;
  lastLogin: string | null;
  lastLogout: string | null;
  sessionTime: string | null;
  statusLayanan: string | null;
  uploadUsage: string | null;
  downloadUsage: string | null;
}

type Tab = "delinquent" | "customers" | "invoices" | "payments";

const HIDE_KEY = "billing-hide-numbers";
const MONTHS = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const rupiah = (n: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

function periodLabel(p: string): string {
  if (p === "all") return "Semua periode";
  const [y, m] = p.split("-");
  return MONTHS[Number(m)] ? `${MONTHS[Number(m)]} ${y}` : p;
}

// Batas jaringan: bentuk jawaban dijaga route /api/billing/runsnet ({ ok, data }); null bila gagal atau kosong.
async function readData<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  const body: { data?: T | null } | null = await res.json().catch(() => null);
  return body?.data ?? null;
}

const cell = "px-3 py-2.5";
const head = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const tone =
    s === "paid" || s === "active" || s === "terhubung"
      ? "text-success"
      : s === "unpaid" || s === "isolir" || s === "terminate" || s.includes("terputus") || s.includes("tidak")
        ? "text-destructive"
        : "text-warning";
  const label = s === "paid" ? "Lunas" : s === "unpaid" ? "Belum bayar" : s === "partial" ? "Sebagian" : status;
  return <span className={cn("text-xs font-medium", tone)}>{label}</span>;
}

function Tile({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 break-all text-sm font-medium", value === null && "text-muted-foreground")}>{value ?? "-"}</div>
    </div>
  );
}

export function RunsnetBillingBoard() {
  const currentMonth = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);

  const [tab, setTab] = useState<Tab>("delinquent");
  const [period, setPeriod] = useState(currentMonth);
  const [hidden, setHidden] = useState(true);
  const [query, setQuery] = useState("");
  const [overview, setOverview] = useState<RunsnetOverview | null>(null);
  const [delinquent, setDelinquent] = useState<DelinquentItem[]>([]);
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [payments, setPayments] = useState<PaymentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [live, setLive] = useState<CustomerLive | null | undefined>(undefined);

  // Pilihan sembunyikan angka diingat di peramban; bawaan tersembunyi.
  useEffect(() => {
    const t = setTimeout(() => setHidden(localStorage.getItem(HIDE_KEY) !== "0"), 0);
    return () => clearTimeout(t);
  }, []);
  const toggleHidden = () =>
    setHidden((h) => {
      localStorage.setItem(HIDE_KEY, h ? "0" : "1");
      return !h;
    });
  // Semua angka (nominal dan jumlah) jadi titik saat disembunyikan; ID dan tanggal tetap terlihat.
  const m = (text: string) => (hidden ? text.replace(/\d[\d.,]*/g, "•••") : text);

  useEffect(() => {
    let active = true;
    const run = async () => {
      setLoading(true);
      try {
        const p = period !== "all" ? `&periode=${period}` : "";
        const [ov, items] = await Promise.all([
          fetch(`/api/billing/runsnet?tab=overview${p}`),
          fetch(`/api/billing/runsnet?tab=${tab}&limit=300${p}`),
        ]);
        if (!active) return;
        if (ov.ok) setOverview(await readData<RunsnetOverview>(ov));
        if (tab === "delinquent") setDelinquent((await readData<DelinquentItem[]>(items)) ?? []);
        if (tab === "customers") setCustomers((await readData<CustomerItem[]>(items)) ?? []);
        if (tab === "invoices") setInvoices((await readData<InvoiceItem[]>(items)) ?? []);
        if (tab === "payments") setPayments((await readData<PaymentItem[]>(items)) ?? []);
      } catch (e) {
        console.error("Gagal memuat data billing RunsNet:", e);
      } finally {
        if (active) setLoading(false);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [tab, period, refreshKey]);

  // Detail pelanggan: riwayat dari database, info layanan langsung dari RunsNet (bisa lambat/tidak ada).
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const reset = setTimeout(() => {
      setDetail(null);
      setLive(undefined);
    }, 0);
    void fetch(`/api/billing/runsnet?tab=customer-detail&custId=${selected}`)
      .then((r) => readData<CustomerDetail>(r))
      .then((d) => active && d && setDetail(d))
      .catch(() => {});
    void fetch(`/api/billing/runsnet?tab=customer-live&custId=${selected}`)
      .then((r) => readData<CustomerLive>(r))
      .then((d) => active && setLive(d))
      .catch(() => active && setLive(null));
    return () => {
      active = false;
      clearTimeout(reset);
    };
  }, [selected]);

  async function sync() {
    setSyncing(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/billing/runsnet/sync", { method: "POST" });
      const json: { ok?: boolean; message?: string; error?: string } | null = await res.json().catch(() => null);
      const ok = res.ok && json?.ok === true;
      setFeedback({ ok, text: ok ? (json?.message ?? "Sinkronisasi selesai.") : (json?.error ?? "Sinkronisasi gagal.") });
      if (ok) setRefreshKey((k) => k + 1);
    } catch (e) {
      setFeedback({ ok: false, text: e instanceof Error ? e.message : "Jaringan bermasalah saat sinkronisasi." });
    } finally {
      setSyncing(false);
    }
  }

  const q = query.trim().toLowerCase();
  const has = (...f: (string | null | undefined)[]) => !q || f.some((x) => x?.toLowerCase().includes(q));
  const rowsDelinquent = delinquent.filter((d) => has(d.custName, d.custId, d.serviceProfile));
  const rowsCustomers = customers.filter((c) => has(c.name, c.custId, c.serviceProfile, c.ipAddress, c.macAddress));
  const rowsInvoices = invoices.filter((i) => has(i.custName, i.custId, i.invoiceCode));
  const rowsPayments = payments.filter((p) => has(p.custName, p.custId, p.paymentCode, p.invoiceCode));

  const periods = useMemo(() => {
    const set = new Set([currentMonth, ...(overview?.availablePeriods ?? [])]);
    return [...set].sort().reverse();
  }, [currentMonth, overview?.availablePeriods]);

  const empty = (n: number, text: string) =>
    n === 0 && <p className="px-3 py-10 text-center text-sm text-muted-foreground">{loading ? "Memuat…" : text}</p>;
  const detailBtn = (id: string) => (
    <button type="button" className="text-xs text-primary hover:underline" onClick={() => setSelected(id)}>
      Detail
    </button>
  );

  const kpis = overview
    ? [
        { label: "Menunggak", value: String(overview.delinquentCustomersCount), hint: `${rupiah(overview.invoices.unpaidAmount)} belum dibayar`, tone: "text-destructive" },
        { label: "Pelanggan", value: String(overview.customers.total), hint: `${overview.customers.active} aktif · ${overview.customers.isolir} isolir`, tone: "" },
        { label: "Tagihan", value: rupiah(overview.invoices.totalAmount), hint: `${overview.invoices.paidCount} lunas · ${overview.invoices.unpaidCount} belum bayar`, tone: "" },
        { label: "Pembayaran", value: rupiah(overview.payments.totalPaid), hint: `${overview.payments.total} transaksi`, tone: "text-success" },
      ]
    : [];

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "delinquent", label: "Menunggak", count: overview?.delinquentCustomersCount },
    { id: "customers", label: "Pelanggan", count: overview?.customers.total },
    { id: "invoices", label: "Invoice", count: overview?.invoices.total },
    { id: "payments", label: "Pembayaran", count: overview?.payments.total },
  ];

  return (
    <div className="flex flex-col gap-5" data-testid="runsnet-billing-board">
      {/* Bilah atas: periode, sembunyikan angka, sinkron */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          aria-label="Periode"
          className="h-9 rounded-md border bg-background px-2.5 text-sm"
        >
          {periods.map((p) => (
            <option key={p} value={p}>
              {p === currentMonth ? `Bulan ini · ${periodLabel(p)}` : periodLabel(p)}
            </option>
          ))}
          <option value="all">Semua periode</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          {overview?.lastSync && (
            <span className="hidden text-xs text-muted-foreground sm:block">
              Sinkron terakhir{" "}
              {new Date(overview.lastSync.startedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "short" })}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleHidden}
            aria-pressed={hidden}
            title={hidden ? "Tampilkan angka" : "Sembunyikan angka"}
            data-testid="toggle-hide-numbers"
          >
            {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            <span className="hidden sm:inline">{hidden ? "Angka tersembunyi" : "Angka terlihat"}</span>
          </Button>
          <Button type="button" size="sm" onClick={sync} disabled={syncing}>
            <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
            Sinkronkan
          </Button>
        </div>
      </div>

      {feedback && (
        <p role={feedback.ok ? "status" : "alert"} className={cn("text-sm", feedback.ok ? "text-success" : "text-destructive")}>
          {feedback.text}
        </p>
      )}

      {/* Ringkasan */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border bg-card p-4">
            <div className="text-xs text-muted-foreground">{k.label}</div>
            <div className={cn("mt-1 text-2xl font-semibold tabular-nums", k.tone)}>{m(k.value)}</div>
            <div className="mt-1 text-xs text-muted-foreground">{m(k.hint)}</div>
          </div>
        ))}
      </div>

      {/* Daftar */}
      <div className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2">
          <div role="tablist" className="flex gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  tab === t.id ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
                {t.count !== undefined && <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{t.count}</span>}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-64">
            <Search aria-hidden="true" className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nama, ID, invoice…"
              aria-label="Cari"
              className="h-8 w-full rounded-md border bg-background pl-8 pr-2 text-sm"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          {tab === "delinquent" && (
            <>
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr>
                    <th className={head}>Pelanggan</th>
                    <th className={head}>Paket</th>
                    <th className={cn(head, "text-right")}>Tertunggak</th>
                    <th className={cn(head, "text-right")}>Total</th>
                    <th className={head}>Jatuh tempo tertua</th>
                    <th className={head} />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rowsDelinquent.map((d) => (
                    <tr key={d.custId} className="hover:bg-muted/30">
                      <td className={cell}>
                        <div className="font-medium">{d.custName}</div>
                        <div className="font-mono text-xs text-muted-foreground">{d.custId}</div>
                      </td>
                      <td className={cn(cell, "text-muted-foreground")}>{d.serviceProfile ?? "-"}</td>
                      <td className={cn(cell, "text-right tabular-nums")}>{m(`${d.unpaidCount} bln`)}</td>
                      <td className={cn(cell, "text-right font-medium tabular-nums text-destructive")}>{m(rupiah(d.totalDebt))}</td>
                      <td className={cn(cell, "text-muted-foreground")}>{d.oldestDueDate ?? "-"}</td>
                      <td className={cn(cell, "text-right")}>{detailBtn(d.custId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {empty(rowsDelinquent.length, "Tidak ada pelanggan menunggak pada periode ini.")}
            </>
          )}

          {tab === "customers" && (
            <>
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr>
                    <th className={head}>Pelanggan</th>
                    <th className={head}>Paket</th>
                    <th className={head}>IP</th>
                    <th className={head}>MAC</th>
                    <th className={head}>Koneksi</th>
                    <th className={head}>Status</th>
                    <th className={head} />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rowsCustomers.map((c) => (
                    <tr key={c.custId} className="hover:bg-muted/30">
                      <td className={cell}>
                        <div className="font-medium">{c.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{c.custId}</div>
                      </td>
                      <td className={cell}>
                        <div className="text-muted-foreground">{c.serviceProfile ?? "-"}</div>
                        {c.type && <div className="text-xs text-muted-foreground/70">{c.type}</div>}
                      </td>
                      {[c.ipAddress, c.macAddress].map((v, k) => (
                        <td
                          key={k}
                          className={cn(cell, "font-mono text-xs", c.connectivity?.toLowerCase() !== "terhubung" && "text-muted-foreground")}
                          title={v && c.connectivity?.toLowerCase() !== "terhubung" ? `Sesi terakhir, diperbarui ${c.ipSyncedAt ? new Date(c.ipSyncedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) : "-"}` : undefined}
                        >
                          {v ?? "-"}
                        </td>
                      ))}
                      <td className={cell}>{c.connectivity ? <StatusPill status={c.connectivity} /> : "-"}</td>
                      <td className={cell}>
                        <StatusPill status={c.status} />
                      </td>
                      <td className={cn(cell, "text-right")}>{detailBtn(c.custId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {empty(rowsCustomers.length, "Belum ada data pelanggan.")}
            </>
          )}

          {tab === "invoices" && (
            <>
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr>
                    <th className={head}>Invoice</th>
                    <th className={head}>Pelanggan</th>
                    <th className={head}>Periode</th>
                    <th className={head}>Jatuh tempo</th>
                    <th className={cn(head, "text-right")}>Tagihan</th>
                    <th className={cn(head, "text-right")}>Sisa</th>
                    <th className={head}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rowsInvoices.map((i) => (
                    <tr key={i.invoiceCode} className="hover:bg-muted/30">
                      <td className={cn(cell, "font-mono text-xs")}>
                        {i.fileUrl ? (
                          <a href={`https://app.runsnet.id/view/${i.fileUrl}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            {i.invoiceCode} <ExternalLink className="size-3" aria-hidden="true" />
                          </a>
                        ) : (
                          i.invoiceCode
                        )}
                      </td>
                      <td className={cell}>
                        <button type="button" className="text-left hover:underline" onClick={() => setSelected(i.custId)}>
                          {i.custName}
                        </button>
                      </td>
                      <td className={cn(cell, "text-muted-foreground")}>{i.periode ?? "-"}</td>
                      <td className={cn(cell, "text-muted-foreground")}>{i.dueDate ?? "-"}</td>
                      <td className={cn(cell, "text-right tabular-nums")}>{m(rupiah(i.amount))}</td>
                      <td className={cn(cell, "text-right tabular-nums")}>{m(rupiah(i.remainingAmount))}</td>
                      <td className={cell}>
                        <StatusPill status={i.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {empty(rowsInvoices.length, "Tidak ada invoice pada periode ini.")}
            </>
          )}

          {tab === "payments" && (
            <>
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr>
                    <th className={head}>Pembayaran</th>
                    <th className={head}>Pelanggan</th>
                    <th className={head}>Invoice</th>
                    <th className={head}>Tanggal</th>
                    <th className={cn(head, "text-right")}>Jumlah</th>
                    <th className={head}>Metode</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rowsPayments.map((p) => (
                    <tr key={p.paymentCode} className="hover:bg-muted/30">
                      <td className={cn(cell, "font-mono text-xs")}>{p.paymentCode}</td>
                      <td className={cell}>
                        <button type="button" className="text-left hover:underline" onClick={() => setSelected(p.custId)}>
                          {p.custName}
                        </button>
                      </td>
                      <td className={cn(cell, "font-mono text-xs text-muted-foreground")}>{p.invoiceCode ?? "-"}</td>
                      <td className={cn(cell, "text-muted-foreground")}>{p.payDate ?? "-"}</td>
                      <td className={cn(cell, "text-right font-medium tabular-nums text-success")}>{m(rupiah(p.amount))}</td>
                      <td className={cn(cell, "text-muted-foreground")}>{p.method ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {empty(rowsPayments.length, "Belum ada pembayaran pada periode ini.")}
            </>
          )}
        </div>
      </div>

      {/* Detail pelanggan */}
      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {detail?.customer?.name ?? "Detail pelanggan"}
              {detail?.customer && <Badge variant="outline">{detail.customer.status}</Badge>}
            </DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {selected}
              {detail?.customer?.serviceProfile ? ` · ${detail.customer.serviceProfile}` : ""}
            </DialogDescription>
          </DialogHeader>

          <section aria-label="Info layanan" className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {live === undefined ? (
              <p className="col-span-full text-sm text-muted-foreground">Mengambil info layanan dari RunsNet…</p>
            ) : live === null ? (
              <p className="col-span-full text-sm text-muted-foreground">
                Info layanan tidak tersedia (pelanggan offline atau RunsNet tidak menjawab).
              </p>
            ) : (
              <>
                <Tile label="IP Address" value={live.ipAddress} />
                <Tile label="MAC Address" value={live.macAddress} />
                <Tile label="Last Login" value={live.lastLogin} />
                <Tile label="Last Logout" value={live.lastLogout} />
                <Tile label="Session Time" value={live.sessionTime} />
                <Tile label="Status Layanan" value={live.statusLayanan} />
                {live.uploadUsage !== null && <Tile label="Pemakaian Upload" value={live.uploadUsage} />}
                {live.downloadUsage !== null && <Tile label="Pemakaian Download" value={live.downloadUsage} />}
              </>
            )}
          </section>

          {detail && (
            <div className="grid gap-5 lg:grid-cols-2">
              <section>
                <h3 className="mb-1.5 text-sm font-medium">Tagihan ({detail.invoices.length})</h3>
                <div className="max-h-64 overflow-y-auto rounded-md border">
                  <table className="w-full text-xs">
                    <tbody className="divide-y">
                      {detail.invoices.map((i) => (
                        <tr key={i.invoiceCode}>
                          <td className="px-2.5 py-1.5">
                            <div className="font-mono">{i.invoiceCode}</div>
                            <div className="text-muted-foreground">{i.periode ?? "-"}</div>
                          </td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums">
                            {m(rupiah(i.amount))}
                            {i.remainingAmount > 0 && <div className="text-destructive">sisa {m(rupiah(i.remainingAmount))}</div>}
                          </td>
                          <td className="px-2.5 py-1.5 text-right">
                            <StatusPill status={i.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {detail.invoices.length === 0 && <p className="p-3 text-center text-xs text-muted-foreground">Belum ada tagihan.</p>}
                </div>
              </section>
              <section>
                <h3 className="mb-1.5 text-sm font-medium">Pembayaran ({detail.payments.length})</h3>
                <div className="max-h-64 overflow-y-auto rounded-md border">
                  <table className="w-full text-xs">
                    <tbody className="divide-y">
                      {detail.payments.map((p) => (
                        <tr key={p.paymentCode}>
                          <td className="px-2.5 py-1.5">
                            <div className="font-mono">{p.paymentCode}</div>
                            <div className="text-muted-foreground">{p.payDate ?? "-"}</div>
                          </td>
                          <td className="px-2.5 py-1.5 text-right tabular-nums text-success">{m(rupiah(p.amount))}</td>
                          <td className="px-2.5 py-1.5 text-right text-muted-foreground">{p.method ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {detail.payments.length === 0 && <p className="p-3 text-center text-xs text-muted-foreground">Belum ada pembayaran.</p>}
                </div>
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
