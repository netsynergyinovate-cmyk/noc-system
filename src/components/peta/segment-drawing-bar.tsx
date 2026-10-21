"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import {
  CableRoute,
  CableSegment,
  MapCustomer,
  MapDevice,
} from "@/services/map/types";
import { routePon } from "@/services/map/topology";

export interface SnapPreview {
  key: string;
  geometry?: [number, number][];
  snapped?: boolean;
  reason?: string | null;
  lengthM?: number;
  error?: string | null;
}

interface SegmentDrawingBarProps {
  route: CableRoute;
  /** Perangkat rantai jalur berurutan (asal → … → ujung terakhir) */
  chain: MapDevice[];
  editingSegment: CableSegment | null;
  pointCount: number;
  devices: MapDevice[];
  customers: MapCustomer[];
  fromDeviceId: string;
  onFromChange: (id: string) => void;
  /** "device:<id>" | "customer:<id>" | "new:<odp|odc|pole>" | "" */
  target: string;
  onTargetChange: (target: string) => void;
  preview: SnapPreview | null;
  saving: boolean;
  error: string | null;
  onUndo: () => void;
  onCancel: () => void;
  onSave: (newDevices?: { names: string[]; capacity: number }) => void;
}

const NEW_DEVICE_LABEL: Record<string, string> = {
  odp: "ODP",
  odc: "ODC",
  pole: "Tiang",
};
const NEW_DEVICE_PREFIX: Record<string, string> = {
  odp: "ODP",
  odc: "ODC",
  pole: "TIANG",
};

const formatM = (m: number) => `${Math.round(m).toLocaleString("id-ID")} m`;

export function SegmentDrawingBar({
  route,
  chain,
  editingSegment,
  pointCount,
  devices,
  customers,
  fromDeviceId,
  onFromChange,
  target,
  onTargetChange,
  preview,
  saving,
  error,
  onUndo,
  onCancel,
  onSave,
}: SegmentDrawingBarProps) {
  const [newCapacity, setNewCapacity] = useState("");
  // Mode titik: tiap klik peta = satu perangkat baru, dinamai berurutan pada jalur ini
  const newType = editingSegment ? null : target.startsWith("new:") ? target.slice(4) : null;
  const pon = routePon(route.code);
  const firstIndex = newType
    ? chain.filter((d) => d.type === newType).length + 1
    : 0;
  const newNames = newType
    ? Array.from(
        { length: pointCount },
        (_, i) =>
          `${NEW_DEVICE_PREFIX[newType]} ${firstIndex + i} ${route.name}${pon ? ` PON ${pon}` : ""}`,
      )
    : [];
  const canSave =
    !saving &&
    (newType
      ? pointCount >= 1
      : pointCount >= 2 && (editingSegment !== null || target !== ""));

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] w-[calc(100%-2rem)] max-w-xl bg-card/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl p-3 space-y-2 text-xs pointer-events-auto">
      <div>
        <span className="font-semibold text-foreground">
          {editingSegment
            ? `Rapikan Segmen #${editingSegment.sequence}`
            : "Tarik Segmen Baru"}{" "}
          • {route.code} — {route.name}
        </span>
        <span className="block text-[10px] text-muted-foreground">
          {route.cableType} • {route.fiberCapacity} core
        </span>
        {!editingSegment && (
          <p className="mt-1 text-[11px] leading-relaxed">
            <span className="text-muted-foreground">Rantai: </span>
            {chain.map((d, i) => (
              <span key={d.id}>
                {i > 0 && " → "}
                <span
                  className={
                    d.id === fromDeviceId
                      ? "font-semibold text-primary"
                      : "text-foreground"
                  }
                >
                  {d.name}
                </span>
              </span>
            ))}
            {newType
              ? newNames.map((n) => (
                  <span key={n}>
                    {" → "}
                    <span className="font-semibold text-primary">{n}</span>
                  </span>
                ))
              : target && (
                  <>
                    {" → "}
                    <span className="font-semibold text-primary">
                      {target.startsWith("customer:")
                        ? customers.find((c) => `customer:${c.id}` === target)?.name
                        : devices.find((d) => `device:${d.id}` === target)?.name}
                    </span>
                  </>
                )}
          </p>
        )}
        <p className="text-[10px] text-muted-foreground">
          {newType
            ? `Klik peta di lokasi ${NEW_DEVICE_LABEL[newType]} berurutan (${NEW_DEVICE_LABEL[newType]} ${firstIndex}, ${firstIndex + 1}, …). Kabel otomatis ditarik menyusuri jalan dari titik sebelumnya.`
            : `${pointCount} titik. Klik peta menyusuri jalan dari asal; titik terakhir = tujuan. Garis otomatis ditarik ke jalan terdekat.`}{" "}
          Geser titik untuk memindah, klik kanan / tekan lama untuk menghapus.
        </p>
      </div>

      {!editingSegment && (
        <details className="rounded-lg border border-border px-2 py-1.5">
          <summary className="cursor-pointer text-[10px] text-muted-foreground">
            Opsi: ganti asal, tarik ke pelanggan/perangkat yang ada, ODC/tiang
          </summary>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <label className="space-y-0.5">
            <span className="text-[10px] text-muted-foreground">
              Asal (ujung rantai terakhir)
            </span>
            <select
              value={fromDeviceId}
              onChange={(e) => onFromChange(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-2 py-1.5 outline-none"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  [{d.type.toUpperCase()}] {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-0.5">
            <span className="text-[10px] text-muted-foreground">Tujuan</span>
            <select
              value={target}
              onChange={(e) => onTargetChange(e.target.value)}
              className="w-full bg-background border border-border rounded-lg px-2 py-1.5 outline-none"
            >
              <option value="">-- Pilih tujuan --</option>
              <optgroup label="Perangkat baru di titik terakhir">
                {Object.entries(NEW_DEVICE_LABEL).map(([type, label]) => (
                  <option key={type} value={`new:${type}`}>
                    + {label} baru
                  </option>
                ))}
              </optgroup>
              <optgroup label="Perangkat (ODC/ODP/Tiang)">
                {devices
                  .filter((d) => d.id !== fromDeviceId && d.type !== "server")
                  .map((d) => (
                    <option key={d.id} value={`device:${d.id}`}>
                      [{d.type.toUpperCase()}] {d.name}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Pelanggan (drop)">
                {customers.map((c) => (
                  <option key={c.id} value={`customer:${c.id}`}>
                    {c.name} ({c.customerNumber})
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        </div>
        </details>
      )}

      {newType && (
        <label className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            Kapasitas port tiap {NEW_DEVICE_LABEL[newType]}
          </span>
          <input
            type="number"
            min={0}
            value={newCapacity}
            onChange={(e) => setNewCapacity(e.target.value)}
            placeholder="8"
            className="w-20 bg-background border border-border rounded-lg px-2 py-1 outline-none"
          />
        </label>
      )}

      {pointCount >= (newType ? 1 : 2) && (
        <div role="status" className="text-[11px]">
          {!preview ? (
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Menyesuaikan ke
              jalan...
            </span>
          ) : preview.error ? (
            <span className="text-destructive">{preview.error}</span>
          ) : preview.snapped ? (
            <span className="text-foreground inline-flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-primary" /> Pratinjau
              menempel jalan • {formatM(preview.lengthM ?? 0)}
            </span>
          ) : (
            <span className="text-amber-700 dark:text-amber-400 inline-flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              Belum menempel jalan ({preview.reason}). Bila disimpan, segmen
              ditandai geometri manual • {formatM(preview.lengthM ?? 0)}
            </span>
          )}
          {editingSegment && preview?.lengthM !== undefined && (
            <span className="block text-muted-foreground">
              Panjang lama {formatM(editingSegment.lengthM)} → baru{" "}
              {formatM(preview.lengthM)}
            </span>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={onUndo}
          disabled={pointCount === 0}
          className="px-2.5 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted disabled:opacity-50"
        >
          Hapus Titik Terakhir
        </button>
        <button
          onClick={onCancel}
          className="px-2.5 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted"
        >
          Batal
        </button>
        <button
          onClick={() =>
            onSave(
              newType
                ? { names: newNames, capacity: parseInt(newCapacity, 10) || 8 }
                : undefined,
            )
          }
          disabled={!canSave}
          className="px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50 inline-flex items-center gap-1"
        >
          {saving && <Loader2 className="w-3 h-3 animate-spin" />}
          {error
            ? "Coba lagi"
            : newType
              ? `Simpan ${pointCount} ${NEW_DEVICE_LABEL[newType]}`
              : "Simpan Segmen"}
        </button>
      </div>
    </div>
  );
}
