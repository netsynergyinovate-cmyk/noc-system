"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Users,
  FileText,
  CreditCard,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Search,
  ShieldCheck,
  AlertTriangle,
  Calendar,
  X,
  Eye,
  Filter,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface RunsnetOverview {
  availablePeriods: string[];
  selectedPeriod: string;
  customers: {
    total: number;
    active: number;
    isolir: number;
  };
  invoices: {
    total: number;
    totalAmount: number;
    unpaidAmount: number;
    unpaidCount: number;
    paidCount: number;
  };
  payments: {
    total: number;
    totalPaid: number;
  };
  delinquentCustomersCount: number;
  lastSync: {
    startedAt: string;
    completedAt: string | null;
    status: string;
    customersCount: number;
    invoicesCount: number;
    paymentsCount: number;
    errorMessage: string | null;
  } | null;
}

interface RunsnetCustomerItem {
  id: string;
  custId: string;
  name: string;
  serviceProfile: string | null;
  type: string | null;
  spkDate: string | null;
  activeDate: string | null;
  expiredDate: string | null;
  connectivity: string | null;
  status: string;
  syncedAt: string;
}

interface RunsnetInvoiceItem {
  id: string;
  invoiceCode: string;
  custId: string;
  custName: string;
  periode: string | null;
  dueDate: string | null;
  amount: number;
  remainingAmount: number;
  agent: string | null;
  status: string;
  fileUrl: string | null;
  syncedAt: string;
}

interface RunsnetPaymentItem {
  id: string;
  paymentCode: string;
  invoiceCode: string | null;
  custId: string;
  custName: string;
  periode: string | null;
  payDate: string | null;
  amount: number;
  method: string | null;
  agent: string | null;
  operator: string | null;
  syncedAt: string;
}

interface DelinquentCustomerItem {
  custId: string;
  custName: string;
  serviceProfile: string | null;
  status: string;
  connectivity: string | null;
  unpaidCount: number;
  totalDebt: number;
  oldestDueDate: string | null;
  invoices: {
    invoiceCode: string;
    periode: string | null;
    dueDate: string | null;
    remainingAmount: number;
    amount: number;
  }[];
}

interface CustomerDetailData {
  customer: RunsnetCustomerItem | null;
  invoices: RunsnetInvoiceItem[];
  payments: RunsnetPaymentItem[];
}

function formatRupiah(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatPeriodLabel(p: string): string {
  if (p === "all") return "Semua Periode";
  const [year, month] = p.split("-");
  const monthNames = [
    "",
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];
  const mIndex = Number(month);
  return monthNames[mIndex] ? `${monthNames[mIndex]} ${year}` : p;
}

export function RunsnetBillingBoard() {
  const [activeTab, setActiveTab] = useState<"delinquent" | "customers" | "invoices" | "payments">("delinquent");
  const currentMonthPeriod = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }, []);
  const [selectedPeriode, setSelectedPeriode] = useState<string>("all");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<"all" | "unpaid" | "paid">("all");
  const [overview, setOverview] = useState<RunsnetOverview | null>(null);

  // Tab Data States
  const [customersList, setCustomersList] = useState<RunsnetCustomerItem[]>([]);
  const [delinquentList, setDelinquentList] = useState<DelinquentCustomerItem[]>([]);
  const [invoicesList, setInvoicesList] = useState<RunsnetInvoiceItem[]>([]);
  const [paymentsList, setPaymentsList] = useState<RunsnetPaymentItem[]>([]);

  // Modal Detail State
  const [selectedCustId, setSelectedCustId] = useState<string | null>(null);
  const [customerDetail, setCustomerDetail] = useState<CustomerDetailData | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [syncFeedback, setSyncFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Load data overview & current tab
  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const periodParam = selectedPeriode !== "all" ? `&periode=${selectedPeriode}` : "";
        const statusParam = invoiceStatusFilter !== "all" ? `&status=${invoiceStatusFilter}` : "";

        const [resOverview, resItems] = await Promise.all([
          fetch(`/api/billing/runsnet?tab=overview${periodParam}`),
          fetch(`/api/billing/runsnet?tab=${activeTab}&limit=300${periodParam}${statusParam}`),
        ]);

        if (!active) return;

        if (resOverview.ok) {
          const body = (await resOverview.json()) as { ok: boolean; data: RunsnetOverview };
          if (body.ok && active) setOverview(body.data);
        }

        if (resItems.ok) {
          const body = (await resItems.json()) as { ok: boolean; data: unknown[] };
          if (body.ok && active) {
            if (activeTab === "customers") setCustomersList(body.data as RunsnetCustomerItem[]);
            if (activeTab === "delinquent") setDelinquentList(body.data as DelinquentCustomerItem[]);
            if (activeTab === "invoices") setInvoicesList(body.data as RunsnetInvoiceItem[]);
            if (activeTab === "payments") setPaymentsList(body.data as RunsnetPaymentItem[]);
          }
        }
      } catch (e) {
        console.error("Gagal memuat data billing RunsNet:", e);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void fetchData();

    return () => {
      active = false;
    };
  }, [activeTab, selectedPeriode, invoiceStatusFilter, refreshKey]);

  // Load Customer Detail
  useEffect(() => {
    if (!selectedCustId) return;

    let active = true;
    const fetchDetail = async () => {
      try {
        setIsLoadingDetail(true);
        const res = await fetch(`/api/billing/runsnet?tab=customer-detail&custId=${selectedCustId}`);
        if (res.ok) {
          const body = (await res.json()) as { ok: boolean; data: CustomerDetailData };
          if (body.ok && active) {
            setCustomerDetail(body.data);
          }
        }
      } catch (e) {
        console.error("Gagal memuat detail pelanggan:", e);
      } finally {
        if (active) setIsLoadingDetail(false);
      }
    };
    void fetchDetail();
    return () => {
      active = false;
    };
  }, [selectedCustId]);

  // Trigger Sync
  const handleSyncNow = async () => {
    try {
      setIsSyncing(true);
      setSyncFeedback(null);
      const res = await fetch("/api/billing/runsnet/sync", { method: "POST" });
      const json = (await res.json()) as { ok: boolean; message?: string; error?: string };

      if (res.ok && json.ok) {
        setSyncFeedback({
          type: "success",
          message: json.message || "Sinkronisasi RunsNet selesai berhasil!",
        });
        setRefreshKey((k) => k + 1);
      } else {
        setSyncFeedback({
          type: "error",
          message: json.error || "Gagal melakukan sinkronisasi dengan server RunsNet.",
        });
      }
    } catch (e) {
      setSyncFeedback({
        type: "error",
        message: e instanceof Error ? e.message : "Terjadi kendala jaringan saat sinkronisasi.",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  // Filter items based on search query
  const filteredDelinquent = delinquentList.filter(
    (d) =>
      d.custName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.custId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (d.serviceProfile && d.serviceProfile.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  const filteredCustomers = customersList.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.custId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.serviceProfile && c.serviceProfile.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  const filteredInvoices = invoicesList.filter(
    (i) =>
      i.custName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.invoiceCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.custId.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const filteredPayments = paymentsList.filter(
    (p) =>
      p.custName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.paymentCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.invoiceCode && p.invoiceCode.toLowerCase().includes(searchQuery.toLowerCase())),
  );

  return (
    <div className="flex flex-col gap-6" data-testid="runsnet-billing-board">
      {/* 1. Header Banner & Sinkronisasi */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-[#111317] p-4 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-100">
                Integrasi Billing RunsNet (Live Production)
              </h2>
              <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px] font-mono">
                Tersambung: app.runsnet.id
              </Badge>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Akun: <span className="font-mono text-zinc-300">netsynergyinovate@yahoo.com</span> • Target ID:{" "}
              <span className="font-mono text-zinc-300">ID00000000024 (Net Synergy Inovate)</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {overview?.lastSync && (
            <div className="text-right text-xs text-zinc-400 font-mono hidden sm:block">
              <p>Terakhir Sinkron:</p>
              <p className="text-zinc-200">
                {new Date(overview.lastSync.startedAt).toLocaleString("id-ID", {
                  timeZone: "Asia/Jakarta",
                  dateStyle: "short",
                  timeStyle: "medium",
                })}{" "}
                WIB
              </p>
            </div>
          )}
          <Button
            onClick={handleSyncNow}
            disabled={isSyncing}
            className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2 font-medium text-xs px-4 py-2"
          >
            <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "Menyinkronkan..." : "Sinkronkan Sekarang"}
          </Button>
        </div>
      </div>

      {/* Notifikasi Hasil Sinkron */}
      {syncFeedback && (
        <div
          className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
            syncFeedback.type === "success"
              ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-300"
              : "bg-rose-950/40 border-rose-800/60 text-rose-300"
          }`}
        >
          {syncFeedback.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          )}
          <span>{syncFeedback.message}</span>
        </div>
      )}

      {/* 2. Filter Bar Periode Bulan */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-zinc-800 bg-[#14171d]">
        <div className="flex flex-wrap items-center gap-2">
          <Calendar className="h-4 w-4 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wider mr-1">
            Periode:
          </span>

          {/* Tombol Instan: Bulan Ini */}
          <button
            type="button"
            onClick={() => setSelectedPeriode(currentMonthPeriod)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              selectedPeriode === currentMonthPeriod
                ? "bg-emerald-600 text-white font-semibold shadow-sm shadow-emerald-900/40 ring-1 ring-emerald-400"
                : "bg-zinc-800/90 text-zinc-300 hover:bg-zinc-700 hover:text-white"
            }`}
          >
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${selectedPeriode === currentMonthPeriod ? "bg-emerald-300 opacity-75" : "hidden"}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${selectedPeriode === currentMonthPeriod ? "bg-emerald-300" : "bg-zinc-500"}`}></span>
            </span>
            ⚡ Bulan Ini ({formatPeriodLabel(currentMonthPeriod)})
          </button>

          {/* Tombol Instan: Semua Periode */}
          <button
            type="button"
            onClick={() => setSelectedPeriode("all")}
            className={`inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              selectedPeriode === "all"
                ? "bg-zinc-200 text-zinc-900 font-semibold shadow-sm"
                : "bg-zinc-800/90 text-zinc-300 hover:bg-zinc-700 hover:text-white"
            }`}
          >
            Semua Periode
          </button>

          {/* Dropdown Pemilihan Bulan Lainnya */}
          <div className="flex items-center gap-1.5 sm:ml-2">
            <span className="text-[11px] text-zinc-400">Pilih Bulan:</span>
            <select
              value={selectedPeriode}
              onChange={(e) => setSelectedPeriode(e.target.value)}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-500"
            >
              <option value="all">Semua Periode (Kumulatif 2025 - 2026)</option>
              {overview?.availablePeriods?.map((p) => (
                <option key={p} value={p}>
                  {formatPeriodLabel(p)} ({p}){p === currentMonthPeriod ? " — Bulan Ini" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-xs text-zinc-400 font-mono">
          Periode Terpilih:{" "}
          <span className="text-emerald-400 font-semibold">{formatPeriodLabel(selectedPeriode)}</span>
        </div>
      </div>

      {/* 3. Tiles Metrik Operasional Riil */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Pelanggan Menunggak (Highlight Kritis) */}
        <div
          onClick={() => setActiveTab("delinquent")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeTab === "delinquent"
              ? "border-rose-500/60 bg-rose-950/20 shadow-md shadow-rose-950/30"
              : "border-zinc-800 bg-[#111317] hover:border-zinc-700"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-rose-400">Pelanggan Menunggak</span>
            <AlertTriangle className="h-4 w-4 text-rose-400" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-rose-400">
            {overview?.delinquentCustomersCount ?? 0}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400">
            <span>Total tagihan menunggak:</span>
            <span className="text-rose-300 font-semibold">{formatRupiah(overview?.invoices.unpaidAmount ?? 0)}</span>
          </div>
        </div>

        {/* Card 2: Total Pelanggan RunsNet */}
        <div
          onClick={() => setActiveTab("customers")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeTab === "customers"
              ? "border-emerald-500/60 bg-emerald-950/20 shadow-md shadow-emerald-950/30"
              : "border-zinc-800 bg-[#111317] hover:border-zinc-700"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">Total Pelanggan</span>
            <Users className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-white">
            {overview?.customers.total ?? "—"}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400">
            <span className="text-emerald-400 font-semibold">{overview?.customers.active ?? 0} Aktif</span>
            <span>•</span>
            <span className="text-rose-400 font-semibold">{overview?.customers.isolir ?? 0} Isolir</span>
          </div>
        </div>

        {/* Card 3: Total Nilai Tagihan (Sesuai Periode) */}
        <div
          onClick={() => setActiveTab("invoices")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeTab === "invoices"
              ? "border-sky-500/60 bg-sky-950/20 shadow-md shadow-sky-950/30"
              : "border-zinc-800 bg-[#111317] hover:border-zinc-700"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">Tagihan ({formatPeriodLabel(selectedPeriode)})</span>
            <FileText className="h-4 w-4 text-sky-400" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-white">
            {formatRupiah(overview?.invoices.totalAmount ?? 0)}
          </div>
          <div className="mt-1 text-[11px] text-zinc-400 truncate flex items-center justify-between">
            <span>{overview?.invoices.paidCount ?? 0} Lunas</span>
            <span className="text-amber-400 font-semibold">{overview?.invoices.unpaidCount ?? 0} Belum Bayar</span>
          </div>
        </div>

        {/* Card 4: Total Penerimaan Pembayaran */}
        <div
          onClick={() => setActiveTab("payments")}
          className={`p-4 rounded-xl border cursor-pointer transition-all ${
            activeTab === "payments"
              ? "border-purple-500/60 bg-purple-950/20 shadow-md shadow-purple-950/30"
              : "border-zinc-800 bg-[#111317] hover:border-zinc-700"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400">Penerimaan Pembayaran</span>
            <CreditCard className="h-4 w-4 text-purple-400" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-emerald-400">
            {formatRupiah(overview?.payments.totalPaid ?? 0)}
          </div>
          <div className="mt-1 text-[11px] text-zinc-400">
            Dari {overview?.payments.total ?? 0} transaksi pembayaran
          </div>
        </div>
      </div>

      {/* 4. Panel Tabel Utama & Filter */}
      <div className="rounded-xl border border-zinc-800 bg-[#111317] overflow-hidden">
        {/* Navigation Tabs Bar */}
        <div className="flex flex-wrap items-center justify-between border-b border-zinc-800 p-3 px-4 gap-3">
          <div className="flex items-center gap-1.5 bg-zinc-900/80 p-1 rounded-lg border border-zinc-800">
            <button
              onClick={() => setActiveTab("delinquent")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
                activeTab === "delinquent"
                  ? "bg-rose-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Pelanggan Menunggak ({overview?.delinquentCustomersCount ?? 0})
            </button>
            <button
              onClick={() => setActiveTab("customers")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === "customers"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Semua Pelanggan ({overview?.customers.total ?? 0})
            </button>
            <button
              onClick={() => setActiveTab("invoices")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === "invoices"
                  ? "bg-sky-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Invoice Tagihan ({overview?.invoices.total ?? 0})
            </button>
            <button
              onClick={() => setActiveTab("payments")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                activeTab === "payments"
                  ? "bg-purple-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Riwayat Payment ({overview?.payments.total ?? 0})
            </button>
          </div>

          {/* Sub-Filter Khusus Invoice */}
          {activeTab === "invoices" && (
            <div className="flex items-center gap-1 bg-zinc-900/80 p-1 rounded-md border border-zinc-800 text-xs">
              <Filter className="h-3 w-3 text-zinc-400 ml-1" />
              <button
                onClick={() => setInvoiceStatusFilter("all")}
                className={`px-2 py-0.5 rounded text-[11px] ${
                  invoiceStatusFilter === "all" ? "bg-zinc-700 text-white" : "text-zinc-400"
                }`}
              >
                Semua
              </button>
              <button
                onClick={() => setInvoiceStatusFilter("unpaid")}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                  invoiceStatusFilter === "unpaid" ? "bg-amber-600 text-white" : "text-amber-400"
                }`}
              >
                Belum Bayar
              </button>
              <button
                onClick={() => setInvoiceStatusFilter("paid")}
                className={`px-2 py-0.5 rounded text-[11px] ${
                  invoiceStatusFilter === "paid" ? "bg-emerald-600 text-white" : "text-emerald-400"
                }`}
              >
                Lunas
              </button>
            </div>
          )}

          <div className="relative min-w-[220px]">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
            <input
              type="text"
              placeholder="Cari nama, ID, invoice..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md border border-zinc-800 bg-zinc-900/80 pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-700 font-mono"
            />
          </div>
        </div>

        {/* TAB 1: PELANGGAN MENUNGGAK (Fitur Utama Yang Diminta) */}
        {activeTab === "delinquent" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-900/60 text-zinc-400 uppercase tracking-wider text-[10px] font-mono border-b border-zinc-800">
                <tr>
                  <th className="py-2.5 px-3">Cust ID</th>
                  <th className="py-2.5 px-3">Nama Pelanggan</th>
                  <th className="py-2.5 px-3">Paket Layanan</th>
                  <th className="py-2.5 px-3 text-center">Tagihan Tertunggak</th>
                  <th className="py-2.5 px-3 text-right">Total Tunggakan</th>
                  <th className="py-2.5 px-3">Jatuh Tempo Tertua</th>
                  <th className="py-2.5 px-3">Status Koneksi</th>
                  <th className="py-2.5 px-3 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-mono">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-zinc-500">
                      Memuat daftar pelanggan menunggak...
                    </td>
                  </tr>
                ) : filteredDelinquent.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-emerald-400">
                      ✓ Tidak ada pelanggan menunggak pada periode ini. Semua tagihan telah lunas!
                    </td>
                  </tr>
                ) : (
                  filteredDelinquent.map((d) => (
                    <tr key={d.custId} className="hover:bg-zinc-900/40">
                      <td className="py-2.5 px-3 font-semibold text-rose-400">{d.custId}</td>
                      <td className="py-2.5 px-3 text-white font-sans font-medium">{d.custName}</td>
                      <td className="py-2.5 px-3 text-zinc-300">{d.serviceProfile || "—"}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                          {d.unpaidCount} Bulan
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-rose-400">
                        {formatRupiah(d.totalDebt)}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-400">{d.oldestDueDate || "—"}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            d.status.toLowerCase() === "active"
                              ? "bg-amber-500/20 text-amber-300"
                              : "bg-rose-500/20 text-rose-300"
                          }`}
                        >
                          {d.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedCustId(d.custId)}
                          className="h-7 text-xs text-sky-400 hover:text-sky-300 hover:bg-sky-500/10 gap-1 px-2"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Detail
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 2: SEMUA PELANGGAN */}
        {activeTab === "customers" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-900/60 text-zinc-400 uppercase tracking-wider text-[10px] font-mono border-b border-zinc-800">
                <tr>
                  <th className="py-2.5 px-3">Cust ID</th>
                  <th className="py-2.5 px-3">Nama Pelanggan</th>
                  <th className="py-2.5 px-3">Paket Layanan</th>
                  <th className="py-2.5 px-3">Tipe</th>
                  <th className="py-2.5 px-3">SPK / Tgl</th>
                  <th className="py-2.5 px-3">Konektivitas</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-mono">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-zinc-500">
                      Memuat data pelanggan RunsNet...
                    </td>
                  </tr>
                ) : filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-zinc-500">
                      Belum ada data pelanggan tersimpan. Klik &quot;Sinkronkan Sekarang&quot; di atas.
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((c) => (
                    <tr key={c.id} className="hover:bg-zinc-900/40">
                      <td className="py-2.5 px-3 font-semibold text-emerald-400">{c.custId}</td>
                      <td className="py-2.5 px-3 text-white font-sans font-medium">{c.name}</td>
                      <td className="py-2.5 px-3 text-zinc-300">{c.serviceProfile || "—"}</td>
                      <td className="py-2.5 px-3 text-zinc-400">{c.type || "—"}</td>
                      <td className="py-2.5 px-3 text-zinc-400">{c.spkDate || "—"}</td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] ${
                            c.connectivity?.toLowerCase().includes("terhubung")
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-zinc-800 text-zinc-400"
                          }`}
                        >
                          {c.connectivity || "—"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            c.status.toLowerCase() === "active"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : c.status.toLowerCase() === "isolir"
                              ? "bg-rose-500/20 text-rose-300"
                              : "bg-amber-500/20 text-amber-300"
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedCustId(c.custId)}
                          className="h-7 text-xs text-sky-400 hover:text-sky-300 hover:bg-sky-500/10 gap-1 px-2"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Rincian
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 3: INVOICES (DAPAT DIFILTER BELUM BAYAR & BULAN) */}
        {activeTab === "invoices" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-900/60 text-zinc-400 uppercase tracking-wider text-[10px] font-mono border-b border-zinc-800">
                <tr>
                  <th className="py-2.5 px-3">Kode Invoice</th>
                  <th className="py-2.5 px-3">Cust ID</th>
                  <th className="py-2.5 px-3">Nama Pelanggan</th>
                  <th className="py-2.5 px-3">Periode</th>
                  <th className="py-2.5 px-3">Jatuh Tempo</th>
                  <th className="py-2.5 px-3 text-right">Tagihan</th>
                  <th className="py-2.5 px-3 text-right">Sisa Tagihan</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-center">Dokumen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-mono">
                {isLoading ? (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-zinc-500">
                      Memuat data invoice RunsNet...
                    </td>
                  </tr>
                ) : filteredInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-8 text-zinc-500">
                      Belum ada data invoice yang sesuai kriteria filter.
                    </td>
                  </tr>
                ) : (
                  filteredInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-zinc-900/40">
                      <td className="py-2.5 px-3 font-semibold text-sky-400">{inv.invoiceCode}</td>
                      <td className="py-2.5 px-3 text-zinc-400">{inv.custId}</td>
                      <td className="py-2.5 px-3 text-white font-sans">{inv.custName}</td>
                      <td className="py-2.5 px-3 text-zinc-400">{inv.periode || "—"}</td>
                      <td className="py-2.5 px-3 text-zinc-400">{inv.dueDate || "—"}</td>
                      <td className="py-2.5 px-3 text-right text-zinc-200">{formatRupiah(inv.amount)}</td>
                      <td
                        className={`py-2.5 px-3 text-right font-semibold ${
                          inv.remainingAmount > 0 ? "text-amber-400" : "text-emerald-400"
                        }`}
                      >
                        {formatRupiah(inv.remainingAmount)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            inv.status === "paid"
                              ? "bg-emerald-500/20 text-emerald-400"
                              : "bg-rose-500/20 text-rose-400"
                          }`}
                        >
                          {inv.status === "paid" ? "Lunas" : "Belum Lunas"}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {inv.fileUrl ? (
                          <a
                            href={`https://app.runsnet.id/view/${inv.fileUrl}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sky-400 hover:text-sky-300"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            PDF
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 4: PAYMENTS */}
        {activeTab === "payments" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-900/60 text-zinc-400 uppercase tracking-wider text-[10px] font-mono border-b border-zinc-800">
                <tr>
                  <th className="py-2.5 px-3">Kode Bayar</th>
                  <th className="py-2.5 px-3">Kode Invoice</th>
                  <th className="py-2.5 px-3">Cust ID</th>
                  <th className="py-2.5 px-3">Nama Pelanggan</th>
                  <th className="py-2.5 px-3">Tanggal Bayar</th>
                  <th className="py-2.5 px-3 text-right">Jumlah Dibayar</th>
                  <th className="py-2.5 px-3">Metode</th>
                  <th className="py-2.5 px-3">Petugas / Operator</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-mono">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-zinc-500">
                      Memuat data riwayat payment RunsNet...
                    </td>
                  </tr>
                ) : filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-zinc-500">
                      Belum ada data pembayaran tersimpan pada periode ini.
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map((p) => (
                    <tr key={p.id} className="hover:bg-zinc-900/40">
                      <td className="py-2.5 px-3 font-semibold text-purple-400">{p.paymentCode}</td>
                      <td className="py-2.5 px-3 text-zinc-400">{p.invoiceCode || "—"}</td>
                      <td className="py-2.5 px-3 text-zinc-400">{p.custId}</td>
                      <td className="py-2.5 px-3 text-white font-sans">{p.custName}</td>
                      <td className="py-2.5 px-3 text-zinc-300">{p.payDate || "—"}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-emerald-400">
                        {formatRupiah(p.amount)}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-300">{p.method || "—"}</td>
                      <td className="py-2.5 px-3 text-zinc-400">{p.operator || p.agent || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. MODAL POPUP DETAIL PELANGGAN (RIWAYAT LENGKAP) */}
      {selectedCustId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-3xl rounded-xl border border-zinc-800 bg-[#111317] p-5 text-white shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Users className="h-4 w-4 text-emerald-400" />
                  Rincian Pelanggan &amp; Riwayat Tagihan
                </h3>
                <p className="text-xs text-zinc-400 font-mono mt-0.5">Cust ID: {selectedCustId}</p>
              </div>
              <button
                onClick={() => {
                  setSelectedCustId(null);
                  setCustomerDetail(null);
                }}
                className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {isLoadingDetail ? (
              <div className="py-12 text-center text-xs text-zinc-400">
                Memuat rincian data pelanggan dari PostgreSQL...
              </div>
            ) : customerDetail?.customer ? (
              <div className="space-y-5 pt-4 text-xs font-mono">
                {/* Profile Box */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 rounded-lg bg-zinc-900/80 border border-zinc-800">
                  <div>
                    <span className="text-[10px] text-zinc-400 block">Nama Pelanggan</span>
                    <span className="font-sans font-semibold text-zinc-100">{customerDetail.customer.name}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-400 block">Paket Layanan</span>
                    <span className="text-emerald-400 font-semibold">{customerDetail.customer.serviceProfile || "—"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-400 block">Status Layanan</span>
                    <span
                      className={`inline-block px-1.5 py-0.2 rounded text-[10px] font-semibold mt-0.5 ${
                        customerDetail.customer.status.toLowerCase() === "active"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-rose-500/20 text-rose-300"
                      }`}
                    >
                      {customerDetail.customer.status}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-400 block">Tipe Kontrak</span>
                    <span className="text-zinc-300">{customerDetail.customer.type || "—"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-400 block">Tanggal Registrasi</span>
                    <span className="text-zinc-300">{customerDetail.customer.spkDate || "—"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-zinc-400 block">Konektivitas</span>
                    <span className="text-zinc-300">{customerDetail.customer.connectivity || "—"}</span>
                  </div>
                </div>

                {/* Invoices List for this customer */}
                <div>
                  <h4 className="text-xs font-semibold text-zinc-200 mb-2 flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-sky-400" />
                    Daftar Tagihan ({customerDetail.invoices.length} Lembar)
                  </h4>
                  <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/40 max-h-48 overflow-y-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-zinc-800/60 text-zinc-400 text-[10px] uppercase">
                        <tr>
                          <th className="py-2 px-2.5">Invoice</th>
                          <th className="py-2 px-2.5">Periode</th>
                          <th className="py-2 px-2.5">Jatuh Tempo</th>
                          <th className="py-2 px-2.5 text-right">Tagihan</th>
                          <th className="py-2 px-2.5 text-right">Sisa</th>
                          <th className="py-2 px-2.5 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        {customerDetail.invoices.map((inv) => (
                          <tr key={inv.id}>
                            <td className="py-1.5 px-2.5 text-sky-400">{inv.invoiceCode}</td>
                            <td className="py-1.5 px-2.5">{inv.periode || "—"}</td>
                            <td className="py-1.5 px-2.5">{inv.dueDate || "—"}</td>
                            <td className="py-1.5 px-2.5 text-right">{formatRupiah(inv.amount)}</td>
                            <td
                              className={`py-1.5 px-2.5 text-right font-semibold ${
                                inv.remainingAmount > 0 ? "text-rose-400" : "text-emerald-400"
                              }`}
                            >
                              {formatRupiah(inv.remainingAmount)}
                            </td>
                            <td className="py-1.5 px-2.5 text-center">
                              <span
                                className={`px-1 rounded text-[9px] font-semibold ${
                                  inv.status === "paid" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                                }`}
                              >
                                {inv.status === "paid" ? "Lunas" : "Belum Lunas"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Payments List for this customer */}
                <div>
                  <h4 className="text-xs font-semibold text-zinc-200 mb-2 flex items-center gap-1.5">
                    <CreditCard className="h-3.5 w-3.5 text-purple-400" />
                    Riwayat Pembayaran Terverifikasi ({customerDetail.payments.length} Transaksi)
                  </h4>
                  <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/40 max-h-48 overflow-y-auto">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-zinc-800/60 text-zinc-400 text-[10px] uppercase">
                        <tr>
                          <th className="py-2 px-2.5">Kode Bayar</th>
                          <th className="py-2 px-2.5">Tgl Bayar</th>
                          <th className="py-2 px-2.5">Metode</th>
                          <th className="py-2 px-2.5 text-right">Nominal</th>
                          <th className="py-2 px-2.5">Operator</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        {customerDetail.payments.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="text-center py-4 text-zinc-500">
                              Belum ada transaksi pembayaran tercatat.
                            </td>
                          </tr>
                        ) : (
                          customerDetail.payments.map((p) => (
                            <tr key={p.id}>
                              <td className="py-1.5 px-2.5 text-purple-400">{p.paymentCode}</td>
                              <td className="py-1.5 px-2.5">{p.payDate || "—"}</td>
                              <td className="py-1.5 px-2.5">{p.method || "—"}</td>
                              <td className="py-1.5 px-2.5 text-right text-emerald-400 font-bold">
                                {formatRupiah(p.amount)}
                              </td>
                              <td className="py-1.5 px-2.5 text-zinc-400">{p.operator || "—"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-zinc-500">Data pelanggan tidak ditemukan.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
