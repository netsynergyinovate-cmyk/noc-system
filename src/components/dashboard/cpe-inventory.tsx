"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { cn } from "cn";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  mapOnuToCustomer,
  type DashboardOnu,
  type OnuStatusFilter,
} from "@/lib/dashboard/onus";
import {
  EMPTY_INVENTORY_FILTER,
  brandOptions,
  filterInventory,
  modelOptions,
  onuMac,
  parseOnuModel,
  summarizeInventory,
  type InventoryFilter,
} from "@/lib/dashboard/onu-inventory";
import { useDashboardStore } from "@/lib/dashboard/store";
import { mapOnuLive } from "@/lib/dashboard/olt-live";
import { useLiveOnus } from "@/lib/dashboard/use-live-onus";
import { formatInteger } from "@/lib/dashboard/format";
import { formatLastSeen } from "@/lib/dashboard/onu-status";
import { selectClassName } from "./select-class";
import { MapOnuDialog } from "./map-onu-dialog";
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
  active?: boolean;
  tone?: "neutral" | "success" | "danger" | "warning";
  onClick?: () => void;
  testId?: string;
}) {
  const colors = {
    neutral: "border-border text-foreground",
    success: "border-success/30 text-success",
    danger: "border-destructive/30 text-destructive",
    warning: "border-warning/30 text-warning",
  };
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "rounded-lg border px-3.5 py-3 text-left transition-colors hover:bg-accent",
        active && "bg-accent",
        colors[tone],
      )}
    >
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
      )}
    </button>
  );
}

export function CpeInventory() {
  const [filter, setFilter] = useState<InventoryFilter>(EMPTY_INVENTORY_FILTER);
  const [page, setPage] = useState(1);

  const customers = useDashboardStore((state) => state.customers);
  const live = useLiveOnus(true);
  const onus = live.onus ?? [];
  const [mappingId, setMappingId] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const mappingOnu = onus.find((o) => o.id === mappingId) ?? null;

  const handleSaveMapping = async (
    onuId: string,
    newCustomerId: string | null,
  ) => {
    const customer = newCustomerId
      ? (customers.find((c) => c.id === newCustomerId) ?? null)
      : null;
    if (newCustomerId && !customer) return;
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
  const filtered = !(
    JSON.stringify(filter) === JSON.stringify(EMPTY_INVENTORY_FILTER)
  );

  const olts = useMemo(
    () => [...new Map(onus.map((o) => [o.oltId, o.oltName])).entries()],
    [onus],
  );
  const rows = useMemo(
    () => filterInventory(onus, filter, null),
    [onus, filter],
  );
  const brands = useMemo(
    () => brandOptions(onus, filter, null),
    [onus, filter],
  );
  const models = useMemo(
    () => modelOptions(onus, filter, null),
    [onus, filter],
  );
  const summary = useMemo(() => summarizeInventory(onus, null), [onus]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const pageRows = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const statusTile = (status: OnuStatusFilter) => filter.status === status;
  const colCount = 6;

  return (
    <Card data-testid="onu-inventory-table">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-lg">Perangkat CPE / ONT</CardTitle>
            <CardDescription data-testid="onu-source-note">
              Data dari OLT (polling backend, tiap 30 detik).
            </CardDescription>
          </div>
          <span
            className="text-xs text-muted-foreground tabular-nums"
            data-testid="onu-count"
          >
            Menampilkan {formatInteger(rows.length)} dari{" "}
            {formatInteger(onus.length)} perangkat
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {live.failed && (
          <p
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            Data perangkat belum bisa dimuat dari server. Daftar di bawah adalah
            yang terakhir berhasil dimuat.
          </p>
        )}
        {live.truncated && (
          <p
            role="status"
            className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning"
          >
            Hanya {formatInteger(onus.length)} dari {formatInteger(live.total)}{" "}
            perangkat yang dimuat. Persempit dengan pencarian atau filter OLT.
          </p>
        )}
        {mapError && (
          <p
            role="alert"
            data-testid="onu-map-error"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {mapError}
          </p>
        )}

        {/* Ringkasan status */}
        <div
          className="grid grid-cols-2 gap-2.5 sm:grid-cols-4"
          role="group"
          aria-label="Ringkasan perangkat"
        >
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
          <Tile
            label="Online"
            value={formatInteger(summary.online)}
            tone="success"
            active={statusTile("online")}
            onClick={() =>
              update({ ...EMPTY_INVENTORY_FILTER, status: "online" })
            }
          />
          <Tile
            label="Offline / LOS"
            value={formatInteger(summary.offline + summary.los)}
            hint={`${summary.offline} mati · ${summary.los} LOS`}
            tone="danger"
            active={statusTile("offline")}
            onClick={() =>
              update({ ...EMPTY_INVENTORY_FILTER, status: "offline" })
            }
          />
          <Tile
            label="Sinyal lemah"
            value={formatInteger(summary.weak)}
            hint="RX < -27 dBm"
            tone="warning"
            active={statusTile("weak")}
            onClick={() =>
              update({ ...EMPTY_INVENTORY_FILTER, status: "weak" })
            }
          />
        </div>

        {/* Filter */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] max-w-sm flex-1">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
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
            <option value="all">
              {filter.brand === "all" ? "Semua model" : "Semua model merek ini"}
            </option>
            {models.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label} ({m.count})
              </option>
            ))}
          </select>
          <select
            value={filter.status}
            onChange={(e) =>
              update({ status: e.target.value as OnuStatusFilter })
            }
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

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Perangkat</TableHead>
                <TableHead>SN / MAC</TableHead>
                <TableHead>Pelanggan &amp; jalur PON</TableHead>
                <TableHead>Redaman optik</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={colCount}
                    className="h-28 text-center text-muted-foreground"
                  >
                    {onus.length === 0
                      ? live.onus === null && !live.failed
                        ? "Memuat perangkat dari server…"
                        : "Belum ada perangkat. Daftarkan OLT di tab Daftar OLT; ONU muncul setelah backend berhasil memoll OLT."
                      : "Tidak ada perangkat yang sesuai dengan filter."}
                  </TableCell>
                </TableRow>
              ) : (
                pageRows.map((o) => {
                  const id = parseOnuModel(o.model);
                  return (
                    <TableRow key={o.id}>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-semibold"
                            data-testid="brand-chip"
                          >
                            {id.brandLabel}
                          </span>
                          <span className="text-sm font-medium">
                            {id.modelLabel === "Tidak diketahui" ||
                            id.brandKey === "?"
                              ? ""
                              : id.modelLabel}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {o.model}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div
                          className="font-mono text-xs font-semibold"
                          data-testid="onu-sn"
                        >
                          {o.serialNumber}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                          MAC {onuMac(o.serialNumber) ?? "-"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">
                          {o.customerName}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {o.pppoeUsername}
                        </div>
                        <div
                          className="mt-0.5 text-[11px] text-muted-foreground"
                          data-testid="olt-pon"
                        >
                          {o.oltName} ·{" "}
                          <span className="font-mono">{o.ponPort}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <OpticalRx
                          dbm={o.status === "los" ? null : o.rxPowerDbm}
                        />
                        <div className="mt-1 flex gap-3 text-muted-foreground">
                          <span>
                            TX <OpticalTx dbm={o.txPowerDbm} />
                          </span>
                          <span>
                            Loss{" "}
                            <OpticalLoss
                              txDbm={o.txPowerDbm}
                              rxDbm={o.status === "los" ? null : o.rxPowerDbm}
                            />
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <OnuStatusBadge status={o.status} />
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          <time
                            dateTime={new Date(
                              o.lastSeenAt * 1000,
                            ).toISOString()}
                            title={
                              o.status === "online"
                                ? "Terakhir diukur"
                                : "Terakhir terlihat online"
                            }
                          >
                            {formatLastSeen(o.lastSeenAt)}
                          </time>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-testid="btn-map-onu"
                          onClick={() => setMappingId(o.id)}
                        >
                          {o.customerId === null ? "Petakan" : "Ubah pemetaan"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {rows.length > PAGE_SIZE && (
          <div
            className="flex items-center justify-between text-xs text-muted-foreground"
            data-testid="inventory-pager"
          >
            <span className="tabular-nums">
              Halaman {current} dari {pageCount}
            </span>
            <span className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Halaman sebelumnya"
                aria-disabled={current <= 1}
                className="aria-disabled:opacity-50"
                onClick={() => current > 1 && setPage(current - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Halaman berikutnya"
                aria-disabled={current >= pageCount}
                className="aria-disabled:opacity-50"
                onClick={() => current < pageCount && setPage(current + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </span>
          </div>
        )}

        <MapOnuDialog
          onu={mappingOnu}
          open={mappingOnu !== null}
          onOpenChange={(o) => !o && setMappingId(null)}
          onSave={handleSaveMapping}
          customers={customers}
        />
      </CardContent>
    </Card>
  );
}
