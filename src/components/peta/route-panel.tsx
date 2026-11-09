"use client";

import {
  X,
  Cable,
  AlertTriangle,
  Plus,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import {
  CableRoute,
  CableSegment,
  MapCustomer,
  MapDevice,
} from "@/services/map/types";
import { useState } from "react";
import { oltPonCount, routePon } from "@/services/map/topology";
import {
  CONNECTION_STYLE,
  FIBER_CAPACITY_OPTIONS,
  connectionStyle,
} from "./map-style";
import { RouteColorPicker } from "./route-drawing-modal";
import { DeviceBadge } from "./device-badge";

export type RouteUpdate = {
  name?: string;
  color?: string;
  cableType?: string;
  fiberCapacity?: number;
  pon?: number;
};

// Ubah identitas jalur; hanya kolom yang berubah yang dikirim
function RouteEditForm({
  route,
  olt,
  routes,
  onSave,
  onDone,
}: {
  route: CableRoute;
  olt: MapDevice | undefined;
  routes: CableRoute[];
  onSave: (data: RouteUpdate) => Promise<void>;
  onDone: () => void;
}) {
  const [name, setName] = useState(route.name);
  const [color, setColor] = useState(route.color ?? "");
  const [cableType, setCableType] = useState(route.cableType);
  const [fiberCapacity, setFiberCapacity] = useState(route.fiberCapacity);
  const [pon, setPon] = useState(routePon(route.code) ?? 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ponCount = olt?.type === "server" ? oltPonCount(olt) : 0;
  const usedBy = (n: number) =>
    routes.find(
      (r) =>
        r.id !== route.id &&
        r.fromDeviceId === route.fromDeviceId &&
        routePon(r.code) === n,
    );
  const inputCls =
    "w-full bg-background border border-border rounded-lg px-2 py-1.5 text-xs outline-none";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Nama jalur wajib diisi.");
      return;
    }
    const data: RouteUpdate = {
      ...(name.trim() !== route.name && { name: name.trim() }),
      ...(color && color !== route.color && { color }),
      ...(cableType.trim() !== route.cableType && {
        cableType: cableType.trim(),
      }),
      ...(fiberCapacity !== route.fiberCapacity && { fiberCapacity }),
      ...(pon > 0 && pon !== routePon(route.code) && { pon }),
    };
    if (Object.keys(data).length === 0) return onDone();
    setError(null);
    setSaving(true);
    try {
      await onSave(data);
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Gagal mengubah jalur.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3 rounded-xl bg-muted/30 border border-primary/40 space-y-2.5"
    >
      <span className="font-semibold text-foreground block">Ubah Jalur</span>
      {error && (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      )}
      <label className="block space-y-1">
        <span className="text-[10px] text-muted-foreground">Nama jalur</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputCls}
        />
      </label>
      <div className="space-y-1">
        <span className="text-[10px] text-muted-foreground block">
          Warna jalur
        </span>
        <RouteColorPicker value={color} onChange={setColor} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {ponCount > 0 && (
          <label className="space-y-1">
            <span className="text-[10px] text-muted-foreground">PON</span>
            <select
              value={pon}
              onChange={(e) => setPon(Number(e.target.value))}
              className={inputCls}
            >
              {pon === 0 && <option value={0}>PON ?</option>}
              {Array.from({ length: ponCount }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n} disabled={Boolean(usedBy(n))}>
                  PON {n}
                  {usedBy(n) ? ` — ${usedBy(n)!.name}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="space-y-1">
          <span className="text-[10px] text-muted-foreground">Kapasitas</span>
          <select
            value={fiberCapacity}
            onChange={(e) => setFiberCapacity(Number(e.target.value))}
            className={inputCls}
          >
            {FIBER_CAPACITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] text-muted-foreground">Tipe kabel</span>
          <input
            value={cableType}
            onChange={(e) => setCableType(e.target.value)}
            className={inputCls}
          />
        </label>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Nama ODP otomatis di jalur ini ikut berganti bila nama atau PON diubah.
      </p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="px-2.5 py-1 rounded-lg border border-border text-muted-foreground hover:bg-muted"
        >
          Batal
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-3 py-1 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50"
        >
          {saving ? "Menyimpan..." : "Simpan"}
        </button>
      </div>
    </form>
  );
}

interface RoutePanelProps {
  route: CableRoute;
  segments: CableSegment[];
  devices: MapDevice[];
  customers?: MapCustomer[];
  onClose: () => void;
  onAddSegment: (route: CableRoute) => void;
  onAddDevice: (route: CableRoute) => void;
  onEditSegment: (route: CableRoute, segment: CableSegment) => void;
  /** Semua jalur, untuk menandai PON yang sudah dipakai */
  routes: CableRoute[];
  onUpdateRoute: (data: RouteUpdate) => Promise<void>;
}

// Panjang 0/kosong berarti belum terhitung dari geometri, bukan nol meter
const formatLength = (m: number | null | undefined) =>
  m && m > 0 ? `${Math.round(m).toLocaleString("id-ID")} m` : "belum tersedia";

export function RoutePanel({
  route,
  segments,
  devices,
  customers = [],
  onClose,
  onAddSegment,
  onAddDevice,
  onEditSegment,
  routes,
  onUpdateRoute,
}: RoutePanelProps) {
  const [editing, setEditing] = useState(false);
  const devMap = new Map(devices.map((d) => [d.id, d]));
  const custMap = new Map(customers.map((c) => [c.id, c]));

  const sortedSegments = [...segments].sort((a, b) => a.sequence - b.sequence);

  // Pisahkan segmen antar-perangkat dengan segmen drop ke pelanggan
  const interDeviceSegments = sortedSegments.filter((s) => !s.customerId);
  const customerDropSegments = sortedSegments.filter((s) =>
    Boolean(s.customerId),
  );

  // Metrik Jarak (Sesuai PRD: diukur dari geometri server)
  const totalLengthM = route.totalLengthM;
  const segmentSumM = sortedSegments.reduce(
    (sum, s) => sum + (s.lengthM || 0),
    0,
  );
  // total_length_m turunan dari segmen; selisih = data tidak konsisten (ditampilkan, tidak diperbaiki diam-diam)
  const totalMismatch = Math.abs(totalLengthM - segmentSumM) > 1;

  const interDeviceDistanceM = interDeviceSegments.reduce(
    (sum, s) => sum + (s.lengthM || 0),
    0,
  );

  const customerDropDistanceM = customerDropSegments.reduce(
    (sum, s) => sum + (s.lengthM || 0),
    0,
  );

  // Pelanggan yang dilayani jalur ini: drop langsung, atau terhubung ke perangkat di rantai jalur
  const routeDeviceIds = new Set([
    route.fromDeviceId,
    ...sortedSegments.flatMap((s) => [s.fromDeviceId, s.toDeviceId ?? ""]),
  ]);
  const servedCustomers = customers.filter(
    (c) =>
      (c.odpId && routeDeviceIds.has(c.odpId)) ||
      customerDropSegments.some((s) => s.customerId === c.id),
  );
  const statusCounts = (
    Object.keys(CONNECTION_STYLE) as (keyof typeof CONNECTION_STYLE)[]
  ).map((key) => ({
    key,
    ...CONNECTION_STYLE[key],
    count: servedCustomers.filter(
      (c) => connectionStyle(c.status) === CONNECTION_STYLE[key],
    ).length,
  }));

  const unsnappedSegments = sortedSegments.filter((s) => !s.snapped);
  const hasUnsnapped = unsnappedSegments.length > 0;

  const getDeviceIcon = (type?: MapDevice["type"]) =>
    type ? (
      <DeviceBadge type={type} />
    ) : (
      <Cable className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
    );

  return (
    <aside
      aria-label="Panel Jalur Kabel"
      className="fixed inset-x-0 bottom-0 md:bottom-auto md:top-[calc(var(--map-toolbar-bottom,4rem)_+_0.5rem)] md:right-4 md:left-auto z-[1050] md:max-w-[min(28rem,50vw)] w-full bg-card/95 backdrop-blur-md text-card-foreground border border-border shadow-2xl rounded-t-2xl md:rounded-2xl max-h-[60dvh] md:max-h-[calc(100dvh_-_var(--map-toolbar-bottom,4rem)_-_1.5rem)] flex flex-col overflow-hidden animate-in fade-in slide-in-from-right-4 duration-200"
    >
      <div className="flex items-center justify-between p-4 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center border-2"
            style={{ borderColor: route.color ?? "transparent" }}
            title={route.color ? "Warna jalur" : undefined}
          >
            <Cable className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-foreground line-clamp-1">
              {route.name}
            </h3>
            <span className="text-[10px] font-mono text-muted-foreground uppercase">
              {route.code} • {route.fiberCapacity} Core ({route.cableType})
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {!route.readOnly && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="px-2.5 py-1 rounded-lg bg-primary text-primary-foreground font-medium text-[11px] hover:opacity-90"
              type="button"
            >
              Ubah
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            type="button"
            aria-label="Tutup panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-4 overflow-y-auto space-y-4 text-xs">
        {editing && (
          <RouteEditForm
            key={route.id}
            route={route}
            olt={devMap.get(route.fromDeviceId)}
            routes={routes}
            onSave={onUpdateRoute}
            onDone={() => setEditing(false)}
          />
        )}

        {/* Kalkulasi Metrik Jarak Sesuai PRD */}
        <div className="grid grid-cols-3 gap-2">
          {/* Total Panjang Jalur (geometri server) */}
          <div className="p-2.5 rounded-xl bg-muted/40 border border-border flex flex-col justify-between">
            <span className="text-[10px] text-muted-foreground font-medium line-clamp-1">
              Total Jalur (Server)
            </span>
            <div className="my-1">
              <span className="text-sm font-bold text-foreground font-mono">
                {formatLength(totalLengthM)}
              </span>
            </div>
            <span className="text-[9px] text-muted-foreground font-mono truncate">
              {segments.length} Ruas Total
            </span>
          </div>

          {/* Jarak Antar ODP / Perangkat */}
          <div className="p-2.5 rounded-xl bg-muted/40 border border-border flex flex-col justify-between">
            <span className="text-[10px] text-muted-foreground font-medium line-clamp-1">
              Antar Perangkat
            </span>
            <div className="my-1">
              <span className="text-sm font-bold text-purple-600 dark:text-purple-400 font-mono">
                {formatLength(interDeviceDistanceM)}
              </span>
            </div>
            <span className="text-[9px] text-muted-foreground font-mono truncate">
              {interDeviceSegments.length} Segmen
            </span>
          </div>

          {/* Jarak ODP ke Pelanggan */}
          <div className="p-2.5 rounded-xl bg-muted/40 border border-border flex flex-col justify-between">
            <span className="text-[10px] text-muted-foreground font-medium line-clamp-1">
              ODP ke Pelanggan
            </span>
            <div className="my-1">
              <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                {formatLength(customerDropDistanceM)}
              </span>
            </div>
            <span className="text-[9px] text-muted-foreground font-mono truncate">
              {customerDropSegments.length} Segmen Drop
            </span>
          </div>
        </div>

        {/* Status layanan pelanggan pada jalur ini (warna sama dengan garis ODP → pelanggan) */}
        <div className="p-3 rounded-xl bg-muted/30 border border-border space-y-2">
          <span className="font-semibold text-foreground block">
            Status Pelanggan di Jalur ({servedCustomers.length})
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {statusCounts.map((s) => (
              <div
                key={s.key}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-background border border-border/60"
              >
                <span className="flex items-center gap-1.5 text-[11px] text-foreground min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: s.color }}
                  />
                  <span className="truncate">{s.label}</span>
                </span>
                <span className="font-mono font-bold text-foreground">
                  {s.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground">
          Panjang di atas adalah panjang geometri peta. Kebutuhan kabel aktual
          di lapangan perlu ditambah susut, tekukan, dan sisa.
        </p>

        {totalMismatch && (
          <div
            role="alert"
            className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 text-[11px]"
          >
            Data tidak konsisten: total jalur tersimpan{" "}
            {formatLength(totalLengthM)}, jumlah panjang segmen{" "}
            {formatLength(segmentSumM)}.
          </div>
        )}

        {/* Peringatan Khusus Jika Ada Segmen snapped === false */}
        {hasUnsnapped && (
          <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div className="text-[11px] leading-tight space-y-1">
              <span className="font-semibold block">
                Perhatian: {unsnappedSegments.length} segmen kabel belum
                menempel jalan
              </span>
              <p className="text-[10px] text-amber-700/80 dark:text-amber-400/80">
                Segmen di luar jaringan jalan ditandai dengan badge khusus dan
                perlu disesuaikan agar perhitungan jarak akurat.
              </p>
            </div>
          </div>
        )}

        {/* Rantai Jalur Segmen Berurutan: OLT → ODC → ODP → Pelanggan */}
        <div className="p-3 rounded-xl bg-muted/30 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-semibold text-foreground block">
                Rantai Sambungan Kabel Berurutan
              </span>
              <span className="text-[10px] text-muted-foreground">
                Hierarki OLT → ODC → ODP → Pelanggan
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono">
              Sampling ±{route.samplingIntervalM}m
            </span>
          </div>

          {sortedSegments.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic py-2">
              Belum ada segmen polilin untuk rute kabel ini.
            </p>
          ) : (
            <div className="space-y-2.5">
              {sortedSegments.map((seg) => {
                const fromDev = devMap.get(seg.fromDeviceId);
                const toDev = seg.toDeviceId
                  ? devMap.get(seg.toDeviceId)
                  : null;
                const cust = seg.customerId
                  ? custMap.get(seg.customerId)
                  : null;
                const isCustomerDrop = Boolean(seg.customerId);

                const fromName = fromDev?.name || "Perangkat Asal";
                const fromType = fromDev?.type?.toUpperCase() || "DEV";

                const toName = isCustomerDrop
                  ? cust
                    ? `${cust.name} (${cust.customerNumber})`
                    : "Pelanggan Terhubung"
                  : toDev?.name || "Perangkat Tujuan";
                const toType = isCustomerDrop
                  ? "PELANGGAN"
                  : toDev?.type?.toUpperCase() || "DEV";

                const status = seg.connectionStatus || cust?.status;

                return (
                  <div
                    key={seg.id}
                    className={`p-2.5 rounded-lg border space-y-2 transition-all ${
                      !seg.snapped
                        ? "bg-amber-500/[0.04] border-amber-500/30"
                        : "bg-background border-border/60"
                    }`}
                  >
                    {/* Header Segmen: Sequence, Tipe Segmen, Panjang */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-foreground">
                          Segmen #{seg.sequence}
                        </span>
                        {isCustomerDrop ? (
                          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                            Drop Pelanggan
                          </span>
                        ) : (
                          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 font-medium">
                            Antar-Perangkat
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-primary font-bold">
                        {formatLength(seg.lengthM)}
                      </span>
                    </div>

                    {/* Representasi Jalur: Dari (Perangkat) → Ke (Perangkat/Pelanggan) */}
                    <div className="flex items-center gap-2 p-2 rounded-md bg-muted/40 text-[11px]">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {getDeviceIcon(fromDev?.type)}
                        <div className="truncate">
                          <span className="font-medium text-foreground block truncate">
                            {fromName}
                          </span>
                          <span className="text-[9px] font-mono text-muted-foreground">
                            {fromType}
                          </span>
                        </div>
                      </div>

                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />

                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {isCustomerDrop ? (
                          <DeviceBadge
                            type="customer"
                            color={connectionStyle(status).color}
                          />
                        ) : (
                          getDeviceIcon(toDev?.type)
                        )}
                        <div className="truncate">
                          <span className="font-medium text-foreground block truncate">
                            {toName}
                          </span>
                          <span className="text-[9px] font-mono text-muted-foreground">
                            {toType}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Jika Drop Pelanggan: Tampilkan Kondisi Layanan Pelanggan */}
                    {isCustomerDrop && (
                      <div className="flex items-center justify-between text-[10px] px-0.5">
                        <span className="text-muted-foreground">
                          Status ODP ↔ pelanggan:
                        </span>
                        <span className="inline-flex items-center gap-1 font-medium text-foreground">
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{
                              background: connectionStyle(status).color,
                            }}
                          />
                          {connectionStyle(status).label}
                        </span>
                      </div>
                    )}

                    {/* Footer: Snapping Status & Titik Belokan */}
                    <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[10px]">
                      {seg.snapped ? (
                        <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                          <CheckCircle2 className="w-3 h-3" /> Menempel Jalan
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400 bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 rounded-md">
                          <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                          Di luar jaringan jalan / belum menempel jalan
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onEditSegment(route, seg)}
                        className="text-primary hover:underline font-medium"
                      >
                        Rapikan titik ({seg.geometry?.length || 0})
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Tombol Tambah Segmen Lanjutan; jalur pusat hanya-baca */}
        {!route.readOnly && (
          <div className="pt-2 space-y-2">
            <button
              onClick={() => onAddSegment(route)}
              className="w-full py-2 px-3 rounded-xl bg-primary hover:opacity-90 text-primary-foreground font-medium text-xs flex items-center justify-center gap-1.5 shadow-sm transition-opacity"
              type="button"
            >
              <Plus className="w-4 h-4" />
              Tarik Segmen Kabel Lanjutan
            </button>
            <button
              onClick={() => onAddDevice(route)}
              className="w-full py-2 px-3 rounded-xl border border-border hover:bg-muted text-foreground font-medium text-xs flex items-center justify-center gap-1.5 transition-colors"
              type="button"
            >
              <Plus className="w-4 h-4" />
              Pasang ODP/ODC/Tiang di Jalur Ini
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
