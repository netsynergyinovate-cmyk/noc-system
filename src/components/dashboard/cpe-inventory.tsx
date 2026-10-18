"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ListChecks, Radio, RefreshCw, Search, X } from "lucide-react";
import { cn } from "cn";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { mapOnuToCustomer, mockOnus, type DashboardOnu, type OnuStatusFilter } from "@/lib/dashboard/onus";
import {
  EMPTY_INVENTORY_FILTER,
  brandOptions,
  filterInventory,
  genieacsCounts,
  matchOnusToCpe,
  modelOptions,
  parseOnuModel,
  summarizeInventory,
  type CpeMatch,
  type GenieacsFilter,
  type InventoryFilter,
} from "@/lib/dashboard/onu-inventory";
import { useGenieacsRegistry } from "@/lib/dashboard/use-genieacs-registry";
import { useDashboardStore } from "@/lib/dashboard/store";
import { useSession } from "@/components/session-provider";
import { selectPreviewEnabled } from "@/lib/session-store";
import { mapOnuLive } from "@/lib/dashboard/olt-live";
import { useLiveOnus } from "@/lib/dashboard/use-live-onus";
import { formatInteger } from "@/lib/dashboard/format";
import { formatLastSeen } from "@/lib/dashboard/onu-status";
import { selectClassName } from "./select-class";
import { MapOnuDialog } from "./map-onu-dialog";
import { OntWebDialog } from "./ont-web-dialog";
import { BulkRegisterDialog } from "./bulk-register-dialog";
import { OnuStatusBadge } from "./onu-status-badge";
import { OpticalLoss, OpticalRx, OpticalTx } from "./optical-rx";

const PAGE_SIZE = 25;

function Tile({
  label,
  value,
  hint,
  active,
  tone = "neutral",
  onClick,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  active: boolean;
  tone?: "neutral" | "success" | "warning" | "danger";
  onClick: () => void;
  testId?: string;
}) {
  const toneClass = { neutral: "text-foreground", success: "text-success", warning: "text-warning", danger: "text-destructive" }[tone];
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-lg border bg-card px-3.5 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
        active ? "border-primary ring-1 ring-primary/40" : ""
      }`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </button>
  );
}

function SelectAll({ checked, partial, onChange, label }: { checked: boolean; partial: boolean; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = partial && !checked;
  }, [partial, checked]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={checked} onChange={onChange} className="size-4 cursor-pointer" />;
}

function GenieacsCell({ match, known }: { match: CpeMatch | undefined; known: boolean }) {
  if (!known) return <span className="text-xs text-muted-foreground">—</span>;
  if (!match) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground" data-testid="reg-badge" data-registered="false">
        Belum terdaftar
      </span>
    );
  }
  return (
    <div data-testid="reg-badge" data-registered="true">
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
          match.isOnline ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
        }`}
      >
        <span className={`size-1.5 rounded-full ${match.isOnline ? "bg-success" : "bg-warning"}`} aria-hidden="true" />
        Terdaftar · {match.isOnline ? "online" : "offline"}
      </span>
      <div className="mt-0.5 text-[10px] text-muted-foreground">cocok via {match.via === "pppoe" ? "PPPoE" : "MAC"}</div>
    </div>
  );
}

export function CpeInventory() {
  const [filter, setFilter] = useState<InventoryFilter>(EMPTY_INVENTORY_FILTER);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const customers = useDashboardStore((state) => state.customers);
  const isDemo = useSession(selectPreviewEnabled);
  // Mode live: ONU dari OLT lewat database (polling backend Go); demo: data tiruan.
  const live = useLiveOnus(!isDemo);
  const registry = useGenieacsRegistry(!isDemo);
  const [demoOnus, setDemoOnus] = useState<readonly DashboardOnu[]>(mockOnus);
  const liveOnus = live.onus;
  const onus = useMemo<readonly DashboardOnu[]>(() => (isDemo ? demoOnus : (liveOnus ?? [])), [isDemo, demoOnus, liveOnus]);
  const [mappingId, setMappingId] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const mappingOnu = onus.find((o) => o.id === mappingId) ?? null;
  const [ontWebId, setOntWebId] = useState<string | null>(null);
  const ontWebOnu = onus.find((o) => o.id === ontWebId) ?? null;

  // Status GenieACS hanya bermakna bila daftar modemnya berhasil dibaca; selain itu tidak ditebak.
  const reg = useMemo(
    () => (registry.devices === null ? null : matchOnusToCpe(onus, registry.devices)),
    [onus, registry.devices],
  );
  const known = reg !== null;
  const emptyReg = useMemo(() => new Map<string, CpeMatch>(), []);

  // "Daftarkan via OLT": satu perintah tulis nyata ke OLT. Status per baris, tidak hilang sendiri.
  const [bindState, setBindState] = useState<Record<string, { phase: "saving" | "done" | "failed"; message?: string }>>({});
  async function handleBindTr069(o: DashboardOnu) {
    if (o.ponIndex === null || o.onuIndex === null || !o.oltId) return;
    if (bindState[o.id]?.phase === "saving") return;
    setBindState((s) => ({ ...s, [o.id]: { phase: "saving" } }));
    try {
      const res = await fetch(`/api/olts/${o.oltId}/onus/${o.ponIndex}/${o.onuIndex}/tr069-bind`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: { message?: string } } | null;
      setBindState((s) => ({
        ...s,
        [o.id]:
          res.ok && json?.ok
            ? { phase: "done", message: json.message ?? "Berhasil diikat ke GenieACS." }
            : { phase: "failed", message: json?.error?.message ?? "Gagal mengikat ONU ini." },
      }));
    } catch {
      setBindState((s) => ({ ...s, [o.id]: { phase: "failed", message: "Server aplikasi tidak terjangkau." } }));
    }
  }

  const handleSaveMapping = async (onuId: string, newCustomerId: string | null) => {
    const customer = newCustomerId ? (customers.find((c) => c.id === newCustomerId) ?? null) : null;
    if (newCustomerId && !customer) return;
    if (isDemo) {
      setDemoOnus((prev) => prev.map((o) => (o.id === onuId ? mapOnuToCustomer(o, customer) : o)));
      setMappingId(null);
      return;
    }
    const result = await mapOnuLive(onuId, newCustomerId);
    if (!result.ok) {
      setMapError(result.message);
      return;
    }
    setMapError(null);
    await live.reload();
    setMappingId(null);
  };

  const update = (patch: Partial<InventoryFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const filtered = !(JSON.stringify(filter) === JSON.stringify(EMPTY_INVENTORY_FILTER));

  const olts = useMemo(() => [...new Map(onus.map((o) => [o.oltId, o.oltName])).entries()], [onus]);
  const rows = useMemo(() => filterInventory(onus, filter, reg), [onus, filter, reg]);
  const brands = useMemo(() => brandOptions(onus, filter, reg), [onus, filter, reg]);
  const models = useMemo(() => modelOptions(onus, filter, reg), [onus, filter, reg]);
  const regCounts = useMemo(() => (reg ? genieacsCounts(onus, filter, reg) : null), [onus, filter, reg]);
  const summary = useMemo(() => summarizeInventory(onus, reg), [onus, reg]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const pageRows = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const rowIds = rows.map((o) => o.id);
  const selectedInRows = rowIds.filter((id) => selected.has(id)).length;
  const selectedOnus = useMemo(() => onus.filter((o) => selected.has(o.id)), [onus, selected]);
  const allSelected = rows.length > 0 && selectedInRows === rows.length;

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllRows() {
    setSelected((s) => {
      const next = new Set(s);
      if (allSelected) rowIds.forEach((id) => next.delete(id));
      else rowIds.forEach((id) => next.add(id));
      return next;
    });
  }

  const statusTile = (status: OnuStatusFilter) => filter.status === status && filter.genieacs === "all";
  const colCount = 7;

  return (
    <Card data-testid="onu-inventory-table">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Perangkat CPE / ONT</CardTitle>
            <CardDescription data-testid="onu-source-note">
              {isDemo
                ? "Data tiruan; belum terhubung ke OLT nyata."
                : "Data dari OLT (polling backend, tiap 30 detik) dicocokkan dengan modem yang sudah terdaftar di GenieACS."}
            </CardDescription>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums" data-testid="onu-count">
            Menampilkan {formatInteger(rows.length)} dari {formatInteger(onus.length)} perangkat
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isDemo && live.failed && (
          <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Data perangkat belum bisa dimuat dari server. Daftar di bawah adalah yang terakhir berhasil dimuat.
          </p>
        )}
        {!isDemo && registry.failed && (
          <p role="status" className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning">
            Status GenieACS belum bisa dibaca, jadi kolom &quot;GenieACS&quot; dan filternya tidak ditampilkan sampai berhasil.
          </p>
        )}
        {!isDemo && live.truncated && (
          <p role="status" className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning">
            Hanya {formatInteger(onus.length)} dari {formatInteger(live.total)} perangkat yang dimuat. Persempit dengan pencarian atau filter OLT.
          </p>
        )}
        {mapError && (
          <p role="alert" data-testid="onu-map-error" className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {mapError}
          </p>
        )}

        {/* Ringkasan: juga jalan pintas filter */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6" role="group" aria-label="Ringkasan perangkat">
          <Tile
            label="Total perangkat"
            value={formatInteger(summary.total)}
            active={!filtered}
            onClick={() => {
              setFilter(EMPTY_INVENTORY_FILTER);
              setPage(1);
            }}
            testId="tile-total"
          />
          <Tile label="Online" value={formatInteger(summary.online)} tone="success" active={statusTile("online")} onClick={() => update({ ...EMPTY_INVENTORY_FILTER, status: "online" })} />
          <Tile label="Offline / LOS" value={formatInteger(summary.offline + summary.los)} hint={`${summary.offline} mati · ${summary.los} LOS`} tone="danger" active={statusTile("offline")} onClick={() => update({ ...EMPTY_INVENTORY_FILTER, status: "offline" })} />
          <Tile label="Sinyal lemah" value={formatInteger(summary.weak)} hint="RX < -27 dBm" tone="warning" active={statusTile("weak")} onClick={() => update({ ...EMPTY_INVENTORY_FILTER, status: "weak" })} />
          {known ? (
            <>
              <Tile label="Terdaftar di GenieACS" value={formatInteger(summary.registered ?? 0)} tone="success" active={filter.genieacs === "registered"} onClick={() => update({ ...EMPTY_INVENTORY_FILTER, genieacs: "registered" })} testId="tile-registered" />
              <Tile label="Belum terdaftar" value={formatInteger(summary.unregistered ?? 0)} hint="siap didaftarkan" active={filter.genieacs === "unregistered"} onClick={() => update({ ...EMPTY_INVENTORY_FILTER, genieacs: "unregistered" })} testId="tile-unregistered" />
            </>
          ) : (
            <div className="rounded-lg border border-dashed px-3.5 py-3 text-xs text-muted-foreground sm:col-span-2">
              {isDemo ? "Status GenieACS hanya tersedia di mode live." : "Memuat status GenieACS…"}
            </div>
          )}
        </div>

        {/* Filter */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] max-w-sm flex-1">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Cari perangkat"
              placeholder="Cari SN, nama, PPPoE, merek, model…"
              value={filter.query}
              onChange={(e) => update({ query: e.target.value })}
              className="pl-9"
            />
          </div>
          <select
            value={filter.brand}
            onChange={(e) => update({ brand: e.target.value, model: "all" })}
            className={cn(selectClassName, "w-auto min-w-40")}
            aria-label="Filter merek ONT"
            data-testid="filter-brand"
          >
            <option value="all">Semua merek</option>
            {brands.map((b) => (
              <option key={b.key} value={b.key}>
                {b.label} ({b.count})
              </option>
            ))}
          </select>
          <select
            value={filter.model}
            onChange={(e) => update({ model: e.target.value })}
            className={cn(selectClassName, "w-auto min-w-40")}
            aria-label="Filter model ONT"
            data-testid="filter-model"
          >
            <option value="all">{filter.brand === "all" ? "Semua model" : "Semua model merek ini"}</option>
            {models.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label} ({m.count})
              </option>
            ))}
          </select>
          <select
            value={filter.status}
            onChange={(e) => update({ status: e.target.value as OnuStatusFilter })}
            className={cn(selectClassName, "w-auto min-w-40")}
            aria-label="Filter status ONU"
          >
            <option value="all">Semua status</option>
            <option value="online">Online (aktif)</option>
            <option value="offline">Mati / power off</option>
            <option value="los">Kabel putus / LOS</option>
            <option value="weak">Sinyal lemah (&lt; -27 dBm)</option>
            <option value="out">Sinyal di luar ambang</option>
          </select>
          <select
            value={filter.oltId}
            onChange={(e) => update({ oltId: e.target.value })}
            className={cn(selectClassName, "w-auto min-w-36")}
            aria-label="Filter OLT"
          >
            <option value="all">Semua OLT</option>
            {olts.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          {known && regCounts && (
            <select
              value={filter.genieacs}
              onChange={(e) => update({ genieacs: e.target.value as GenieacsFilter })}
              className={cn(selectClassName, "w-auto min-w-44")}
              aria-label="Filter status GenieACS"
              data-testid="filter-genieacs"
            >
              <option value="all">Semua (GenieACS) ({regCounts.all})</option>
              <option value="registered">Terdaftar ({regCounts.registered})</option>
              <option value="unregistered">Belum terdaftar ({regCounts.unregistered})</option>
            </select>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-disabled={!filtered}
            className="gap-1 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => {
              if (!filtered) return;
              setFilter(EMPTY_INVENTORY_FILTER);
              setPage(1);
            }}
          >
            <X className="size-3.5" />
            Hapus filter
          </Button>
        </div>

        {/* Pilihan massal */}
        {!isDemo && (
          <div
            className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
              selectedOnus.length > 0 ? "border-primary/40 bg-primary/5" : "bg-muted/30"
            }`}
            data-testid="bulk-bar"
          >
            <span className="flex items-center gap-2" role="status">
              <ListChecks className="size-4 text-muted-foreground" aria-hidden="true" />
              {selectedOnus.length > 0
                ? `${formatInteger(selectedOnus.length)} perangkat dipilih`
                : "Centang perangkat di tabel untuk mendaftarkan banyak sekaligus ke GenieACS."}
            </span>
            <span className="flex items-center gap-2">
              {selectedOnus.length > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Kosongkan pilihan
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                data-testid="btn-bulk-register"
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                aria-disabled={selectedOnus.length === 0}
                onClick={() => {
                  if (selectedOnus.length > 0) setBulkOpen(true);
                }}
              >
                <Radio className="size-3.5" />
                Daftarkan ke GenieACS
              </Button>
            </span>
          </div>
        )}

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  {!isDemo && (
                    <SelectAll
                      checked={allSelected}
                      partial={selectedInRows > 0}
                      onChange={toggleAllRows}
                      label={`Pilih semua ${formatInteger(rows.length)} hasil filter`}
                    />
                  )}
                </TableHead>
                <TableHead>Perangkat</TableHead>
                <TableHead>Pelanggan &amp; jalur PON</TableHead>
                <TableHead>Redaman optik</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>GenieACS</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="h-28 text-center text-muted-foreground">
                    {!isDemo && onus.length === 0
                      ? live.onus === null && !live.failed
                        ? "Memuat perangkat dari server…"
                        : "Belum ada perangkat. Daftarkan OLT di tab Daftar OLT; ONU muncul setelah backend berhasil memoll OLT."
                      : "Tidak ada perangkat yang sesuai dengan filter."}
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((o) => {
                  const id = parseOnuModel(o.model);
                  const match = reg?.get(o.id);
                  const checked = selected.has(o.id);
                  return (
                    <TableRow key={o.id} data-state={checked ? "selected" : undefined}>
                      <TableCell>
                        {!isDemo && (
                          <input
                            type="checkbox"
                            className="size-4 cursor-pointer"
                            checked={checked}
                            aria-label={`Pilih ${o.customerName} (${o.serialNumber})`}
                            onChange={() => toggle(o.id)}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-semibold" data-testid="brand-chip">
                            {id.brandLabel}
                          </span>
                          <span className="text-sm font-medium">{id.modelLabel === "Tidak diketahui" || id.brandKey === "?" ? "" : id.modelLabel}</span>
                        </div>
                        <div className="mt-0.5 font-mono text-xs text-muted-foreground">{o.serialNumber}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">{o.customerName}</div>
                        <div className="font-mono text-xs text-muted-foreground">{o.pppoeUsername}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground" data-testid="olt-pon">
                          {o.oltName} · <span className="font-mono">{o.ponPort}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <OpticalRx dbm={o.status === "los" ? null : o.rxPowerDbm} />
                        <div className="mt-1 flex gap-3 text-muted-foreground">
                          <span>
                            TX <OpticalTx dbm={o.txPowerDbm} />
                          </span>
                          <span>
                            Loss <OpticalLoss txDbm={o.txPowerDbm} rxDbm={o.status === "los" ? null : o.rxPowerDbm} />
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <OnuStatusBadge status={o.status} />
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          <time dateTime={new Date(o.lastSeenAt * 1000).toISOString()} title={o.status === "online" ? "Terakhir diukur" : "Terakhir terlihat online"}>
                            {formatLastSeen(o.lastSeenAt)}
                          </time>
                        </div>
                      </TableCell>
                      <TableCell>
                        <GenieacsCell match={match} known={known} />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1.5">
                          <Button type="button" variant="outline" size="sm" data-testid="btn-map-onu" onClick={() => setMappingId(o.id)}>
                            {o.customerId === null ? "Petakan" : "Ubah pemetaan"}
                          </Button>
                          {!isDemo && o.ponIndex !== null && o.onuIndex !== null && (
                            <>
                              {match ? (
                                <Button asChild type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs">
                                  <Link href="/app/genieacs">Lihat di GenieACS</Link>
                                </Button>
                              ) : (
                                <Button type="button" size="sm" data-testid="btn-ont-web" onClick={() => setOntWebId(o.id)}>
                                  Pasang GenieACS
                                </Button>
                              )}
                              <button
                                type="button"
                                data-testid="btn-bind-tr069"
                                className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                                aria-disabled={bindState[o.id]?.phase === "saving"}
                                title="Ikat profil TR-069 lewat perintah telnet ke OLT"
                                onClick={() => {
                                  if (bindState[o.id]?.phase !== "saving") void handleBindTr069(o);
                                }}
                              >
                                {bindState[o.id]?.phase === "saving" ? "Mengikat…" : "atau via OLT"}
                              </button>
                              {bindState[o.id] && bindState[o.id].phase !== "saving" && (
                                <p
                                  role={bindState[o.id].phase === "failed" ? "alert" : "status"}
                                  data-testid="bind-tr069-result"
                                  className={`max-w-48 text-[11px] ${bindState[o.id].phase === "failed" ? "text-destructive" : "text-success"}`}
                                >
                                  {bindState[o.id].message}
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {rows.length > PAGE_SIZE && (
          <div className="flex items-center justify-between text-xs text-muted-foreground" data-testid="inventory-pager">
            <span className="tabular-nums">
              Halaman {current} dari {pageCount}
            </span>
            <span className="flex gap-2">
              <Button type="button" variant="outline" size="sm" aria-label="Halaman sebelumnya" aria-disabled={current <= 1} className="aria-disabled:opacity-50" onClick={() => current > 1 && setPage(current - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <Button type="button" variant="outline" size="sm" aria-label="Halaman berikutnya" aria-disabled={current >= pageCount} className="aria-disabled:opacity-50" onClick={() => current < pageCount && setPage(current + 1)}>
                <ChevronRight className="size-4" />
              </Button>
            </span>
          </div>
        )}

        <OntWebDialog onu={ontWebOnu} open={ontWebOnu !== null} onOpenChange={(open) => !open && setOntWebId(null)} />
        <MapOnuDialog
          onu={mappingOnu}
          open={mappingOnu !== null}
          onOpenChange={(o) => !o && setMappingId(null)}
          onSave={handleSaveMapping}
          customers={customers}
        />
        {bulkOpen && (
          <BulkRegisterDialog
            open={bulkOpen}
            onOpenChange={setBulkOpen}
            onus={selectedOnus}
            reg={reg ?? emptyReg}
            onFinished={() => {
              void registry.reload();
              void live.reload();
            }}
          />
        )}
        {registry.devices !== null && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <RefreshCw className="size-3" aria-hidden="true" />
            {formatInteger(registry.devices.length)} modem terdaftar di GenieACS; status disegarkan tiap 1 menit.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
