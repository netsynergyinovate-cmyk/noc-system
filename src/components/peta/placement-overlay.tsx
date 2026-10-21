"use client";

import { useState } from "react";
import { X, Check, AlertCircle, Loader2 } from "lucide-react";
import { MapCustomer, MapDevice } from "@/services/map/types";
import { COORD_ERROR, parseCoordinates } from "./coords";
import { DEVICE_TYPE_STYLE } from "./map-style";
import { DeviceBadge } from "./device-badge";

export type PlacementModeType = "customer" | "device" | null;

/** Jalur lokal yang bisa disambung; chainEndName = asal segmen otomatis */
export interface PlacementRouteOption {
  id: string;
  label: string;
  chainEndName: string;
}

interface PlacementOverlayProps {
  mode: PlacementModeType;
  coordinates: { lat: number; lng: number } | null;
  onCoordinatesChange: (coords: { lat: number; lng: number }) => void;
  availableDevices?: MapDevice[];
  availableCustomers?: MapCustomer[];
  routeOptions?: PlacementRouteOption[];
  /** Jalur terpilih saat dibuka dari panel jalur */
  initialRouteId?: string;
  /** ODP terpilih saat dibuka dari panel ODP */
  initialOdpId?: string;
  onSave: (formData: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

export function PlacementOverlay({
  mode,
  coordinates,
  onCoordinatesChange,
  availableDevices = [],
  availableCustomers = [],
  routeOptions = [],
  initialRouteId = "",
  initialOdpId = "",
  onSave,
  onCancel,
}: PlacementOverlayProps) {
  // Dipasang ulang tiap mode dibuka, jadi kolom diisi dari koordinat awal
  const [latInput, setLatInput] = useState(coordinates?.lat.toFixed(6) ?? "");
  const [lngInput, setLngInput] = useState(coordinates?.lng.toFixed(6) ?? "");
  const [name, setName] = useState("");
  const [extraField1, setExtraField1] = useState(""); // customerId atau deviceType
  const [extraField2, setExtraField2] = useState(""); // capacity
  const [extraField3, setExtraField3] = useState(initialOdpId); // odpId atau parentDeviceId
  const [routeId, setRouteId] = useState(initialRouteId);
  const [customerQuery, setCustomerQuery] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Sinkronisasi koordinat dari peta ke form input tanpa cascading render effect
  const [prevCoords, setPrevCoords] = useState(coordinates);
  if (coordinates !== prevCoords) {
    setPrevCoords(coordinates);
    if (coordinates) {
      setLatInput(coordinates.lat.toFixed(6));
      setLngInput(coordinates.lng.toFixed(6));
    }
  }

  if (!mode) return null;

  const handleManualCoordChange = (newLatStr: string, newLngStr: string) => {
    setLatInput(newLatStr);
    setLngInput(newLngStr);
    const coords = parseCoordinates(newLatStr, newLngStr);
    if (coords) {
      setErrorMsg(null);
      onCoordinatesChange(coords);
    } else {
      setErrorMsg(COORD_ERROR);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const coords = parseCoordinates(latInput, lngInput);
    if (!coords) {
      setErrorMsg(COORD_ERROR);
      return;
    }
    const { lat, lng } = coords;

    if (mode === "customer" ? !extraField1 || !extraField3 : !name.trim()) {
      setErrorMsg(
        mode === "customer"
          ? "Pilih pelanggan dan ODP yang menghubungkannya."
          : "Nama wajib diisi.",
      );
      return;
    }

    try {
      setSaving(true);
      if (mode === "customer") {
        await onSave({
          customerId: extraField1,
          odpId: extraField3,
          latitude: lat,
          longitude: lng,
        });
      } else {
        const type = (extraField1 || "odp") as "server" | "odc" | "odp" | "pole";
        const capacity = parseInt(extraField2, 10) || 0;
        if (type !== "server" && !routeId) {
          setErrorMsg("Pilih jalur kabel lebih dulu. ODC/ODP/tiang harus tercatat pada rantai jalur.");
          setSaving(false);
          return;
        }
        await onSave({
          name: name.trim(),
          type,
          capacity,
          // Induk ODC/ODP/tiang = ujung rantai jalur, ditentukan server
          ...(type === "server"
            ? { parentDeviceId: extraField3 || null }
            : { routeId }),
          latitude: lat,
          longitude: lng,
        });
      }
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal menyimpan data penempatan.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[1000] pointer-events-auto max-w-md w-full px-4 animate-in fade-in slide-in-from-top-4 duration-200">
      <div className="bg-card/95 backdrop-blur-md text-card-foreground border-2 border-primary/40 shadow-2xl rounded-2xl p-4 max-h-[calc(100dvh-5rem)] overflow-y-auto">
        <div className="flex items-center justify-between pb-2 mb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-primary animate-ping" />
            <h3 className="font-semibold text-sm text-foreground">
              Mode Penempatan: {mode === "customer" ? "Hubungkan Pelanggan" : "Perangkat Jaringan"}
            </h3>
          </div>
          <button
            onClick={onCancel}
            type="button"
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
          Klik pada peta satelit untuk memindahkan penanda bidik, atau ketik angka latitude & longitude di bawah.
        </p>

        {errorMsg && (
          <div className="mb-3 p-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-[11px] flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleFormSubmit} className="space-y-2.5 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                Latitude
              </label>
              <input
                type="text"
                value={latInput}
                onChange={(e) => handleManualCoordChange(e.target.value, lngInput)}
                placeholder="-6.2088"
                className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 font-mono text-xs focus:ring-1 focus:ring-primary outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                Longitude
              </label>
              <input
                type="text"
                value={lngInput}
                onChange={(e) => handleManualCoordChange(latInput, e.target.value)}
                placeholder="106.8456"
                className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 font-mono text-xs focus:ring-1 focus:ring-primary outline-none"
              />
            </div>
          </div>

          {mode === "device" && (
          <div>
            <label className="text-[11px] font-medium text-muted-foreground block mb-1">
              Nama Perangkat
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: ODP-KEMANG-04"
              className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-primary outline-none"
            />
          </div>
          )}

          {mode === "customer" ? (
            <>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                  Pelanggan
                </label>
                <input
                  type="search"
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder="Cari nama atau nomor pelanggan..."
                  aria-label="Cari pelanggan"
                  className="w-full mb-1.5 bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-primary outline-none"
                />
                <select
                  value={extraField1}
                  onChange={(e) => {
                    setExtraField1(e.target.value);
                    const c = availableCustomers.find((x) => x.id === e.target.value);
                    // Pelanggan yang sudah punya titik: pratinjau mulai dari posisinya, bukan tengah peta
                    if (c?.latitude != null && c.longitude != null) {
                      onCoordinatesChange({ lat: c.latitude, lng: c.longitude });
                    }                  }}
                  className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-primary outline-none"
                >
                  <option value="">-- Pilih pelanggan --</option>
                  {availableCustomers
                    // Hanya yang belum punya ODP (ganti ODP lewat panel detail pelanggan);
                    // pilihan yang sudah terpilih tetap ada walau tidak cocok pencarian
                    .filter(
                      (c) =>
                        c.id === extraField1 ||
                        (!c.odpId &&
                          `${c.name} ${c.customerNumber}`
                            .toLowerCase()
                            .includes(customerQuery.trim().toLowerCase())),
                    )
                    .sort((a, b) => Number(a.latitude != null) - Number(b.latitude != null))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.customerNumber})
                        {c.latitude == null ? " • belum ada titik" : ""}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                  Hubungkan ke ODP / ODC
                </label>
                <select
                  value={extraField3}
                  onChange={(e) => setExtraField3(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-primary outline-none"
                >
                  <option value="">-- Pilih ODP / ODC --</option>
                  {(["odp", "odc"] as const).map((t) => (
                    <optgroup key={t} label={t.toUpperCase()}>
                      {availableDevices
                        .filter((d) => d.type === t)
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <div role="radiogroup" aria-label="Jenis perangkat" className="grid grid-cols-4 gap-1.5">
                {(["odp", "odc", "server", "pole"] as const).map((t) => {
                  const active = (extraField1 || "odp") === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setExtraField1(t)}
                      className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] font-medium transition-colors ${
                        active
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      <DeviceBadge type={t} size="md" />
                      {DEVICE_TYPE_STYLE[t].name}
                    </button>
                  );
                })}
              </div>

              <div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                    Kapasitas Port
                  </label>
                  <input
                    type="number"
                    value={extraField2}
                    onChange={(e) => setExtraField2(e.target.value)}
                    placeholder="8"
                    className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-primary outline-none"
                  />
                </div>
              </div>

              {(extraField1 || "odp") !== "server" ? (
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                    Jalur Kabel (wajib)
                  </label>
                  {routeOptions.length === 0 ? (
                    <p className="text-[11px] text-destructive leading-relaxed">
                      Belum ada jalur lokal. Buat identitas jalur dulu lewat menu
                      <strong> Tambah → Rute Jalur Kabel</strong>.
                    </p>
                  ) : (
                    <>
                      <select
                        value={routeId}
                        onChange={(e) => setRouteId(e.target.value)}
                        className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-primary outline-none"
                      >
                        <option value="">-- Pilih jalur --</option>
                        {routeOptions.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      {routeId && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Kabel ditarik dari ujung rantai:{" "}
                          <strong className="text-foreground">
                            {routeOptions.find((r) => r.id === routeId)?.chainEndName}
                          </strong>
                          . Belokan jalur dirapikan setelah disimpan.
                        </p>
                      )}
                    </>
                  )}
                </div>
              ) : (
              <div>
                <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                  Perangkat Induk (Parent)
                </label>
                <select
                  value={extraField3}
                  onChange={(e) => setExtraField3(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-primary outline-none"
                >
                  <option value="">-- Tidak ada (Root) --</option>
                  {availableDevices.map((d) => (
                    <option key={d.id} value={d.id}>
                      [{d.type.toUpperCase()}] {d.name}
                    </option>
                  ))}
                </select>
              </div>
              )}
            </>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted font-medium transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 flex items-center gap-1.5 transition-opacity"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Simpan Posisi
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
