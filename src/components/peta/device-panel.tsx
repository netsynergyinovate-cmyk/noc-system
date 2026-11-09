"use client";

import { useState } from "react";
import {
  X,
  MapPin,
  Trash2,
  Users,
  ChevronRight,
  GitBranch,
  Loader2,
  Cable,
  StickyNote,
  Zap,
  CheckCircle2,
  Ban,
  XCircle,
  WifiOff,
  AlertTriangle,
} from "lucide-react";
import {
  CableRoute,
  CableSegment,
  MapCustomer,
  MapDevice,
} from "@/services/map/types";
import {
  couplerLossDb,
  customerPortCount,
  lossBudget,
  SPLITTER_RATIOS,
  TAP_RATIOS,
  upstreamPath,
} from "@/services/map/loss-budget";
import { haversineDistanceM } from "@/services/map/geo";
import { COORD_ERROR, parseCoordinates } from "./coords";
import { DEVICE_STATUS_LABEL, DEVICE_TYPE_STYLE } from "./map-style";
import { DeviceBadge } from "./device-badge";
import { PortBox } from "./port-box";
import { LossBudgetView } from "./loss-budget-view";
import { OltView } from "./olt-view";

// Warna kabel di kotak port: status pelanggan (di ODP) / status ODP (di ODC)
const CUSTOMER_LEGEND = [
  {
    key: "terhubung",
    label: "Terhubung",
    color: "#10b981",
    Icon: CheckCircle2,
  },
  { key: "isolir", label: "Isolir", color: "#f59e0b", Icon: Ban },
  { key: "loss", label: "Loss / Gangguan", color: "#f43f5e", Icon: XCircle },
  { key: "offline", label: "Offline", color: "#a1a1aa", Icon: WifiOff },
];
const DEVICE_LEGEND = [
  { key: "normal", label: "Normal", color: "#10b981", Icon: CheckCircle2 },
  {
    key: "warning",
    label: "Peringatan",
    color: "#f59e0b",
    Icon: AlertTriangle,
  },
  { key: "critical", label: "Kritis", color: "#f43f5e", Icon: XCircle },
  { key: "offline", label: "Offline", color: "#a1a1aa", Icon: WifiOff },
];
// Status tak dikenal dianggap offline
const legendOf = (legend: typeof CUSTOMER_LEGEND, key: string | null) =>
  legend.find((l) => l.key === key) ?? legend[3];
import { createsCycle, oltPonCount, routePon } from "@/services/map/topology";

interface DevicePanelProps {
  device: MapDevice;
  allDevices: MapDevice[];
  connectedCustomers: MapCustomer[];
  /** Semua pelanggan peta (ODC menampilkan pelanggan di tiap ODP-nya) */
  allCustomers: MapCustomer[];
  cablesIn: CableRoute[];
  cablesOut: CableRoute[];
  /** Semua segmen kabel, untuk jarak & redaman dari OLT */
  segments: CableSegment[];
  onClose: () => void;
  onUpdateNotes: (id: string, notes: string) => Promise<void>;
  onUpdateCoordinates: (id: string, lat: number, lng: number) => Promise<void>;
  onUpdateParent: (id: string, parentId: string | null) => Promise<void>;
  onDeleteDevice: (id: string) => Promise<void>;
  onSelectCustomer: (customer: MapCustomer) => void;
  /** Catat/lepas port ODP pelanggan (port null = lepas) */
  onSetCustomerPort: (customerId: string, port: number | null) => Promise<void>;
  /** Catat/lepas port ODC tempat sebuah ODP dipasang */
  onSetDevicePort: (
    deviceId: string,
    port: number | null,
    odcId?: string,
  ) => Promise<void>;
  /** Ubah rasio splitter ODC/ODP (null = kosongkan) */
  onSetSplitterRatio: (id: string, ratio: number | null) => Promise<void>;
  /** Ubah splitter rasio (persen port tap; null = tidak ada) */
  onSetSplitterTap: (id: string, tapPct: number | null) => Promise<void>;
  /** Ubah jenis perangkat ODP <-> ODC */
  onSetDeviceType: (id: string, type: "odp" | "odc") => Promise<void>;
  /** Tautkan titik OLT ke OLT operasional pusat (null = lepas) */
  onLinkOlt: (deviceId: string, oltId: string | null) => Promise<void>;
  /** Buka panel perangkat lain (induk ODC, ODP di port ODC) */
  onSelectDevice: (device: MapDevice) => void;
  /** Buka form Hubungkan Pelanggan dengan ODP ini terpilih */
  onConnectCustomer: (odp: MapDevice) => void;
  /** Ganti PON asal jalur yang keluar dari OLT ini */
  onUpdateRoutePon: (routeId: string, pon: number) => Promise<void>;
  /** Buka panel jalur (detail + ubah identitas) */
  onSelectRoute: (route: CableRoute) => void;
  /** Draft koordinat (null = tidak sedang mengubah). Dibagi dua arah dengan peta. */
  coordDraft: { lat: string; lng: string } | null;
  onCoordDraftChange: (draft: { lat: string; lng: string } | null) => void;
}

export function DevicePanel({
  device,
  allDevices,
  connectedCustomers,
  allCustomers,
  cablesIn,
  cablesOut,
  segments,
  onClose,
  onUpdateNotes,
  onUpdateCoordinates,
  onUpdateParent,
  onDeleteDevice,
  onSelectCustomer,
  onSetCustomerPort,
  onSetDevicePort,
  onSetSplitterRatio,
  onSetDeviceType,
  onSetSplitterTap,
  onLinkOlt,
  onSelectDevice,
  onConnectCustomer,
  onUpdateRoutePon,
  onSelectRoute,
  coordDraft,
  onCoordDraftChange,
}: DevicePanelProps) {
  const isEditingCoord = coordDraft !== null;
  const lat = coordDraft?.lat ?? "";
  const lng = coordDraft?.lng ?? "";
  const setLat = (v: string) => onCoordDraftChange({ lat: v, lng });
  const setLng = (v: string) => onCoordDraftChange({ lat, lng: v });
  const setIsEditingCoord = (on: boolean) =>
    onCoordDraftChange(
      on
        ? { lat: device.latitude.toFixed(6), lng: device.longitude.toFixed(6) }
        : null,
    );
  const [savingCoord, setSavingCoord] = useState(false);
  const [coordError, setCoordError] = useState<string | null>(null);

  const [selectedParentId, setSelectedParentId] = useState(
    device.parentDeviceId || "",
  );
  const [savingParent, setSavingParent] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingPon, setSavingPon] = useState<string | null>(null);
  const [notes, setNotes] = useState(device.notes ?? "");
  const [savingNotes, setSavingNotes] = useState(false);
  const [savingRatio, setSavingRatio] = useState(false);
  const [savingType, setSavingType] = useState(false);
  const [savingTap, setSavingTap] = useState(false);
  // Galat aksi (induk/keterangan/hapus); tombol tetap aktif sebagai "Coba lagi"
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (
    setBusy: (busy: boolean) => void,
    action: () => Promise<void>,
  ) => {
    setActionError(null);
    try {
      setBusy(true);
      await action();
    } catch (err: unknown) {
      setActionError(
        `${err instanceof Error ? err.message : "Aksi gagal."} Silakan coba lagi.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCoords = async (e: React.FormEvent) => {
    e.preventDefault();
    setCoordError(null);
    const coords = parseCoordinates(lat, lng);
    if (!coords) {
      setCoordError(COORD_ERROR);
      return;
    }

    try {
      setSavingCoord(true);
      await onUpdateCoordinates(device.id, coords.lat, coords.lng);
      setIsEditingCoord(false);
    } catch (err: unknown) {
      setCoordError(
        err instanceof Error ? err.message : "Gagal memperbarui posisi.",
      );
    } finally {
      setSavingCoord(false);
    }
  };

  const handleSaveParent = () =>
    runAction(setSavingParent, () =>
      onUpdateParent(device.id, selectedParentId || null),
    );

  const handleSaveNotes = () =>
    runAction(setSavingNotes, () => onUpdateNotes(device.id, notes.trim()));

  const handleDelete = async () => {
    if (
      !confirm(
        `Hapus perangkat "${device.name}" dari peta? Perangkat buatan peta dihapus permanen beserta segmen kabel yang masuk ke perangkat ini; perangkat dari data NOC hanya disembunyikan di peta (data NOC tidak berubah).`,
      )
    )
      return;
    await runAction(setDeleting, async () => {
      await onDeleteDevice(device.id);
      onClose();
    });
  };

  const typeStyle = DEVICE_TYPE_STYLE[device.type] ?? DEVICE_TYPE_STYLE.odp;
  const isSplitter = device.type === "odc" || device.type === "odp";
  const parent = allDevices.find((d) => d.id === device.parentDeviceId);
  const odcChildren = allDevices.filter(
    (d) => d.parentDeviceId === device.id && d.type === "odp",
  );
  // ODP lain yang belum duduk di port ODC mana pun; dipasang di sini = induknya pindah ke ODC ini
  const odcCandidates =
    device.type === "odc"
      ? allDevices
          .filter(
            (d) =>
              d.type === "odp" &&
              d.parentDeviceId !== device.id &&
              !(
                d.odcPort != null &&
                allDevices.some(
                  (p) => p.id === d.parentDeviceId && p.type === "odc",
                )
              ) &&
              !createsCycle(allDevices, d.id, device.id),
          )
          .map((d) => ({
            d,
            m: haversineDistanceM(
              device.latitude,
              device.longitude,
              d.latitude,
              d.longitude,
            ),
          }))
          .sort((a, b) => a.m - b.m)
          .map(({ d, m }) => ({
            id: d.id,
            name: d.name,
            sub:
              m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`,
          }))
      : [];
  const budget = isSplitter
    ? lossBudget(upstreamPath(device.id, allDevices, segments))
    : null;

  return (
    <aside
      aria-label="Panel Detail Perangkat"
      className="fixed inset-x-0 bottom-0 md:bottom-auto md:top-[calc(var(--map-toolbar-bottom,4rem)_+_0.5rem)] md:right-4 md:left-auto z-[1050] md:max-w-[min(28rem,50vw)] w-full bg-card/95 backdrop-blur-md text-card-foreground border border-border shadow-2xl rounded-t-2xl md:rounded-2xl max-h-[60dvh] md:max-h-[calc(100dvh_-_var(--map-toolbar-bottom,4rem)_-_1.5rem)] flex flex-col overflow-hidden animate-in fade-in slide-in-from-right-4 duration-200"
    >
      <div className="flex items-center justify-between p-4 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2.5">
          <DeviceBadge type={device.type} size="md" />
          <div>
            <h3 className="font-semibold text-sm text-foreground line-clamp-1">
              {device.name}
            </h3>
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {typeStyle.name} • Kapasitas: {device.capacity || 0}
            </span>
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded border border-border text-foreground">
              Status: {DEVICE_STATUS_LABEL[device.status] ?? device.status}
            </span>
          </div>
        </div>

        <button
          onClick={onClose}
          aria-label="Tutup panel perangkat"
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 overflow-y-auto space-y-4 text-xs">
        {actionError && (
          <p role="alert" className="text-[11px] text-destructive">
            {actionError}
          </p>
        )}

        {/* OLT: chassis, port PON, trafik & pemakaian per PON, jalur per PON */}
        {device.type === "server" && (
          <OltView
            device={device}
            routes={cablesOut}
            onSelectRoute={onSelectRoute}
            onLinkOlt={onLinkOlt}
          />
        )}

        {isSplitter && budget && (
          <div className="p-3 rounded-xl bg-muted/30 border border-border space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="splitter-ratio"
                className="font-medium text-foreground flex items-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                Splitter & Redaman
              </label>
              <span className="flex items-center gap-1.5">
                {savingRatio && <Loader2 className="w-3 h-3 animate-spin" />}
                <select
                  id="splitter-ratio"
                  value={device.splitterRatio ?? ""}
                  disabled={savingRatio}
                  onChange={(e) =>
                    runAction(setSavingRatio, () =>
                      onSetSplitterRatio(
                        device.id,
                        e.target.value ? Number(e.target.value) : null,
                      ),
                    )
                  }
                  className="bg-background border border-border rounded-lg px-2 py-1 text-xs"
                >
                  <option value="">Splitter PLC belum diisi</option>
                  {SPLITTER_RATIOS[device.type as "odc" | "odp"].map((r) => (
                    <option key={r} value={r}>
                      1:{r}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            {/* Splitter rasio (coupler tak seimbang): port tap ke PLC kotak ini, port lewat ke kotak berikutnya */}
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="splitter-tap"
                className="text-[11px] text-muted-foreground"
              >
                Splitter rasio (tap:lewat)
              </label>
              <span className="flex items-center gap-1.5">
                {savingTap && <Loader2 className="w-3 h-3 animate-spin" />}
                <select
                  id="splitter-tap"
                  value={device.splitterTap ?? ""}
                  disabled={savingTap}
                  onChange={(e) =>
                    runAction(setSavingTap, () =>
                      onSetSplitterTap(
                        device.id,
                        e.target.value ? Number(e.target.value) : null,
                      ),
                    )
                  }
                  className="bg-background border border-border rounded-lg px-2 py-1 text-xs"
                >
                  <option value="">Tidak ada</option>
                  {TAP_RATIOS.map((p) => {
                    const loss = couplerLossDb(p);
                    return (
                      <option key={p} value={p}>
                        {p}:{100 - p} ({loss.tap} / {loss.pass} dB)
                      </option>
                    );
                  })}
                </select>
              </span>
            </div>
            {/* Jenis perangkat: ODP <-> ODC (mis. ODP yang sebenarnya ODC di lapangan) */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                Jenis perangkat
              </span>
              <div
                role="radiogroup"
                aria-label="Jenis perangkat"
                className="flex gap-1"
              >
                {(["odp", "odc"] as const).map((t) => {
                  const active = device.type === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={active || savingType}
                      onClick={() =>
                        runAction(setSavingType, () =>
                          onSetDeviceType(device.id, t),
                        )
                      }
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors ${
                        active
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <DeviceBadge type={t} />
                      {t.toUpperCase()}
                    </button>
                  );
                })}
                {savingType && (
                  <Loader2 className="w-3 h-3 animate-spin self-center" />
                )}
              </div>
            </div>
            <LossBudgetView
              budget={budget}
              resultLabel={`Perkiraan daya port output ${typeStyle.name}`}
            />
          </div>
        )}

        {/* Port ODC: tiap port ke satu ODP */}
        {device.type === "odc" && (
          <div className="p-3 rounded-xl bg-muted/30 border border-border space-y-2">
            <span className="font-medium text-foreground flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5 text-primary" />
              Port ODC ke ODP ({odcChildren.length})
            </span>
            {/* Satu port splitter ODC = satu ODP */}
            <PortBox
              box={device}
              itemLabel="ODP"
              legend={DEVICE_LEGEND}
              items={odcChildren.map((d) => ({
                id: d.id,
                name: d.name,
                sub: d.splitterRatio ? `ODP 1:${d.splitterRatio}` : "ODP",
                port: d.odcPort,
                color: legendOf(DEVICE_LEGEND, d.status).color,
                Icon: legendOf(DEVICE_LEGEND, d.status).Icon,
              }))}
              candidates={odcCandidates}
              onSetPort={(id, port) =>
                onSetDevicePort(id, port, port === null ? undefined : device.id)
              }
              onOpen={(id) => {
                const d = odcChildren.find((x) => x.id === id);
                if (d) onSelectDevice(d);
              }}
            />

            {/* ODP di ODC ini beserta pelanggannya */}
            {odcChildren.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="text-[10px] uppercase text-muted-foreground">
                  ODP & pelanggan (
                  {
                    allCustomers.filter((c) =>
                      odcChildren.some((d) => d.id === c.odpId),
                    ).length
                  }{" "}
                  pelanggan)
                </div>
                {[...odcChildren]
                  .sort((a, b) => (a.odcPort ?? 999) - (b.odcPort ?? 999))
                  .map((odp) => {
                    const served = allCustomers.filter(
                      (c) => c.odpId === odp.id,
                    );
                    return (
                      <div
                        key={odp.id}
                        className="p-2 rounded-lg bg-background border border-border/60 space-y-1"
                      >
                        <button
                          type="button"
                          onClick={() => onSelectDevice(odp)}
                          className="w-full flex items-center gap-1.5 text-left hover:underline"
                        >
                          <DeviceBadge type="odp" />
                          <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                            {odp.odcPort ? `Port ${odp.odcPort}` : "Port ?"}
                          </span>
                          <span className="font-medium text-foreground truncate flex-1">
                            {odp.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {odp.splitterRatio
                              ? `1:${odp.splitterRatio} • `
                              : ""}
                            {served.length} pelanggan
                          </span>
                          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                        </button>
                        {served.length > 0 && (
                          <div className="flex flex-wrap gap-1 pl-6">
                            {served.map((c) => {
                              const st = legendOf(CUSTOMER_LEGEND, c.status);
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => onSelectCustomer(c)}
                                  title={`${c.name} • ${st.label}`}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-border/60 hover:bg-muted text-[10px] text-foreground"
                                >
                                  <st.Icon
                                    aria-hidden
                                    className="w-3 h-3"
                                    style={{ color: st.color }}
                                    strokeWidth={2.5}
                                  />
                                  {c.odpPort ? `${c.odpPort}·` : ""}
                                  {c.name}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* Keterangan */}
        <div className="p-3 rounded-xl bg-muted/30 border border-border space-y-2">
          <label
            htmlFor="device-notes"
            className="font-medium text-foreground flex items-center gap-1.5"
          >
            <StickyNote className="w-3.5 h-3.5 text-primary" />
            Keterangan
          </label>
          <textarea
            id="device-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
            rows={2}
            placeholder="Belum ada keterangan."
            className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs outline-none resize-y"
          />
          <div className="flex justify-end">
            <button
              onClick={handleSaveNotes}
              disabled={savingNotes || notes.trim() === (device.notes ?? "")}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium text-xs disabled:opacity-50 transition-opacity"
            >
              {savingNotes ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                "Simpan"
              )}
            </button>
          </div>
        </div>

        {/* Hubungan Induk (Reparenting) */}
        <div className="p-3 rounded-xl bg-muted/30 border border-border space-y-2">
          <label className="font-medium text-foreground flex items-center gap-1.5 block">
            <GitBranch className="w-3.5 h-3.5 text-primary" />
            Perangkat Induk (Parent)
          </label>
          <div className="flex gap-2">
            <select
              value={selectedParentId}
              onChange={(e) => setSelectedParentId(e.target.value)}
              className="flex-1 bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs outline-none"
            >
              <option value="">-- Tanpa Induk (Root) --</option>
              {allDevices
                .filter((d) => !createsCycle(allDevices, device.id, d.id))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    [{d.type.toUpperCase()}] {d.name}
                  </option>
                ))}
            </select>
            <button
              onClick={handleSaveParent}
              disabled={
                savingParent ||
                selectedParentId === (device.parentDeviceId || "")
              }
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium text-xs disabled:opacity-50 transition-opacity"
            >
              {savingParent ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                "Pindah"
              )}
            </button>
          </div>
          {parent && (
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="text-muted-foreground">
                {parent.type === "odc" && device.type === "odp"
                  ? device.odcPort
                    ? `Terpasang di port ${device.odcPort} ${parent.name}`
                    : `Port di ${parent.name} belum dicatat`
                  : `Induk: ${parent.name}`}
              </span>
              <button
                type="button"
                onClick={() => onSelectDevice(parent)}
                className="text-primary hover:underline font-medium flex items-center gap-0.5 shrink-0"
              >
                Buka {DEVICE_TYPE_STYLE[parent.type]?.name ?? "induk"}{" "}
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* Koordinat */}
        <div className="p-3 rounded-xl bg-muted/30 border border-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-primary" />
              Posisi Koordinat
            </span>
            {!isEditingCoord && (
              <button
                onClick={() => {
                  setCoordError(null);
                  setIsEditingCoord(true);
                }}
                className="text-primary hover:underline font-medium text-[11px]"
              >
                Ubah
              </button>
            )}
          </div>

          {isEditingCoord ? (
            <form onSubmit={handleSaveCoords} className="space-y-2 pt-1">
              <p className="text-[10px] text-muted-foreground">
                Klik atau geser penanda di peta, atau ketik manual.
              </p>
              {coordError && (
                <p className="text-[11px] text-destructive">{coordError}</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono"
                  placeholder="Lat"
                />
                <input
                  type="text"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono"
                  placeholder="Lng"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditingCoord(false)}
                  className="px-2.5 py-1 rounded text-muted-foreground hover:bg-muted"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingCoord}
                  className="px-3 py-1 rounded bg-primary text-primary-foreground font-medium flex items-center gap-1"
                >
                  {savingCoord && <Loader2 className="w-3 h-3 animate-spin" />}
                  Simpan
                </button>
              </div>
            </form>
          ) : (
            <p className="font-mono text-muted-foreground text-[11px]">
              {device.latitude.toFixed(6)}, {device.longitude.toFixed(6)}
            </p>
          )}
        </div>

        {/* Pelanggan yang Terlayani */}
        <div className="p-3 rounded-xl bg-muted/30 border border-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-medium text-foreground flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-primary" />
              Pelanggan Terhubung ({connectedCustomers.length})
            </span>
            {isSplitter && (
              <button
                type="button"
                onClick={() => onConnectCustomer(device)}
                className="px-2.5 py-1 rounded-lg bg-primary text-primary-foreground font-medium text-[11px] hover:opacity-90"
              >
                + Hubungkan Pelanggan
              </button>
            )}
          </div>

          {isSplitter && (
            <PortBox
              box={device}
              ports={
                device.type === "odc" ? customerPortCount(device) : undefined
              }
              itemLabel="pelanggan"
              legend={CUSTOMER_LEGEND}
              items={connectedCustomers.map((c) => ({
                id: c.id,
                name: c.name,
                sub: c.customerNumber,
                port: c.odpPort,
                color: legendOf(CUSTOMER_LEGEND, c.status).color,
                Icon: legendOf(CUSTOMER_LEGEND, c.status).Icon,
              }))}
              onSetPort={onSetCustomerPort}
              onOpen={(id) => {
                const c = connectedCustomers.find((x) => x.id === id);
                if (c) onSelectCustomer(c);
              }}
            />
          )}

          {connectedCustomers.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic py-1">
              Belum ada pelanggan yang tersambung ke perangkat ini.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {connectedCustomers.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onSelectCustomer(c)}
                  className="w-full flex items-center justify-between p-2 rounded-lg bg-background hover:bg-muted text-left border border-border/50 transition-colors"
                >
                  <div>
                    <div className="font-medium text-foreground">{c.name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {c.customerNumber}
                    </div>
                  </div>
                  <span className="flex items-center gap-1.5">
                    {c.odpPort != null && (
                      <span className="px-1.5 py-0.5 rounded bg-blue-600/10 text-blue-600 dark:text-blue-400 text-[10px] font-mono">
                        Port {c.odpPort}
                      </span>
                    )}
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Jalur Kabel Masuk & Keluar */}
        <div className="p-3 rounded-xl bg-muted/30 border border-border space-y-2">
          <span className="font-medium text-foreground flex items-center gap-1.5">
            <Cable className="w-3.5 h-3.5 text-primary" />
            Jalur Kabel
          </span>
          {(
            [
              ["Masuk", cablesIn],
              ["Keluar", cablesOut],
            ] as const
          ).map(([label, list]) => (
            <div key={label}>
              <div className="text-[10px] uppercase text-muted-foreground mb-1">
                {label} ({list.length})
              </div>
              {list.length === 0 ? (
                <p className="text-[11px] text-muted-foreground italic">
                  Belum ada jalur kabel {label.toLowerCase()}.
                </p>
              ) : (
                <ul className="space-y-1">
                  {list.map((r) => (
                    <li
                      key={r.id}
                      className="p-2 rounded-lg bg-background border border-border/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => onSelectRoute(r)}
                          title="Buka jalur untuk melihat detail dan mengubahnya"
                          className="min-w-0 flex-1 text-left flex items-center gap-2 rounded hover:bg-muted -m-1 p-1"
                        >
                          {r.color && (
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0 border border-border"
                              style={{ background: r.color }}
                            />
                          )}
                          <span className="min-w-0">
                            <span className="font-mono text-foreground block truncate">
                              {r.code}
                            </span>
                            <span className="text-muted-foreground">
                              {r.name} • {r.fiberCapacity} core
                            </span>
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-auto" />
                        </button>
                        {/* OLT: PON jalur bisa diganti bila salah port / port dipindah */}
                        {device.type === "server" &&
                          label === "Keluar" &&
                          !r.readOnly && (
                            <select
                              aria-label={`PON jalur ${r.name}`}
                              value={routePon(r.code) ?? ""}
                              disabled={savingPon === r.id}
                              onChange={(e) => {
                                const pon = Number(e.target.value);
                                void runAction(
                                  (on) => setSavingPon(on ? r.id : null),
                                  () => onUpdateRoutePon(r.id, pon),
                                );
                              }}
                              className="shrink-0 bg-background border border-border rounded px-1.5 py-1 text-[11px]"
                            >
                              {routePon(r.code) === null && (
                                <option value="">PON ?</option>
                              )}
                              {Array.from(
                                { length: oltPonCount(device) },
                                (_, i) => i + 1,
                              ).map((n) => {
                                const usedBy = list.find(
                                  (o) =>
                                    o.id !== r.id && routePon(o.code) === n,
                                );
                                return (
                                  <option
                                    key={n}
                                    value={n}
                                    disabled={Boolean(usedBy)}
                                  >
                                    PON {n}
                                    {usedBy ? ` — ${usedBy.name}` : ""}
                                  </option>
                                );
                              })}
                            </select>
                          )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>

        {/* Tombol Hapus */}
        <div className="pt-2 border-t border-border">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="w-full py-2 px-3 rounded-xl border border-destructive/30 hover:bg-destructive/10 text-destructive font-medium text-xs flex items-center justify-center gap-1.5 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            {deleting ? "Menghapus..." : "Hapus Perangkat"}
          </button>
        </div>
      </div>
    </aside>
  );
}
