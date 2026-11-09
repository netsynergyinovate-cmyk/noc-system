"use client";

import { useState } from "react";
import { X, Cable, Check, AlertCircle, Loader2 } from "lucide-react";
import { CableRoute, MapDevice } from "@/services/map/types";
import { oltPonCount, routePon } from "@/services/map/topology";
import { FIBER_CAPACITY_OPTIONS, ROUTE_COLORS } from "./map-style";

interface RouteDrawingModalProps {
  isOpen: boolean;
  onClose: () => void;
  devices: MapDevice[];
  routes: CableRoute[];
  onCreateRoute: (data: {
    code: string;
    name: string;
    cableType: string;
    fiberCapacity: number;
    fromDeviceId: string;
    toDeviceId?: string;
    color?: string;
  }) => Promise<CableRoute>;
}

// Dipakai juga oleh form ubah jalur di panel jalur
export function RouteColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Warna jalur"
      className="flex flex-wrap gap-2"
    >
      {ROUTE_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={value === c.value}
          aria-label={c.name}
          title={c.name}
          onClick={() => onChange(c.value)}
          className={`w-7 h-7 rounded-full border-2 transition-transform ${
            value === c.value
              ? "border-foreground scale-110"
              : "border-border hover:scale-105"
          }`}
          style={{ background: c.value }}
        />
      ))}
    </div>
  );
}

const slug = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function RouteDrawingModal({
  isOpen,
  onClose,
  devices,
  routes,
  onCreateRoute,
}: RouteDrawingModalProps) {
  const [name, setName] = useState("");
  const [cableType, setCableType] = useState("ADSS 24 Core");
  const [fiberCapacity, setFiberCapacity] = useState(24);
  const [fromDeviceId, setFromDeviceId] = useState("");
  const [pon, setPon] = useState("");
  const [color, setColor] = useState<string>(ROUTE_COLORS[0].value);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const olts = devices.filter((d) => d.type === "server");
  const olt = olts.find((d) => d.id === fromDeviceId);
  // PON yang sudah dipakai jalur lain dari OLT ini tidak bisa dipilih lagi
  const usedPon = new Map(
    routes
      .filter((r) => r.fromDeviceId === fromDeviceId)
      .flatMap((r) => {
        const n = routePon(r.code);
        return n ? [[n, r.name] as const] : [];
      }),
  );
  const ponCount = olt ? oltPonCount(olt) : 0;
  // Kode unik otomatis: satu jalur per PON per OLT
  const code = olt && pon ? `JLR-${slug(olt.name)}-PON${pon}` : "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!olt) {
      setErrorMsg("Pilih OLT asal jalur kabel.");
      return;
    }
    if (!name.trim()) {
      setErrorMsg("Isi nama jalur lebih dulu.");
      return;
    }
    if (!pon) {
      setErrorMsg("Pilih PON asal jalur.");
      return;
    }

    try {
      setSaving(true);
      await onCreateRoute({
        code,
        name: name.trim(),
        cableType,
        fiberCapacity,
        fromDeviceId,
        color,
      });
      onClose();
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "Gagal membuat rute kabel.",
      );
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full bg-background border border-border rounded-lg px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-primary outline-none";
  const labelCls = "text-[11px] font-medium text-muted-foreground block mb-1";

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card text-card-foreground border border-border shadow-2xl rounded-2xl max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2">
            <Cable className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-sm text-foreground">
              Buat Jalur Kabel Baru
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup"
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3 text-xs">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Pilih OLT, beri nama jalur, lalu pilih PON dan warna. Setelah
            disimpan, klik peta di lokasi ODP 1, ODP 2, dan seterusnya; kabel
            otomatis mengikuti jalan.
          </p>

          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-[11px] flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div>
            <label className={labelCls}>OLT Asal</label>
            {olts.length === 0 ? (
              <p className="text-[11px] text-destructive">
                Belum ada OLT/server di peta. Tambahkan lewat Tambah → Perangkat
                Jaringan (jenis Server / OLT).
              </p>
            ) : (
              <select
                value={fromDeviceId}
                onChange={(e) => {
                  setFromDeviceId(e.target.value);
                  setPon("");
                }}
                className={inputCls}
              >
                <option value="">-- Pilih OLT --</option>
                {olts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {olt && (
            <>
              <div>
                <label className={labelCls}>Nama Jalur</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: Desa Sukamaju"
                  autoFocus
                  className={inputCls}
                />
              </div>

              <div>
                <label className={labelCls}>
                  PON ({olt.name}: {ponCount} port)
                </label>
                <select
                  value={pon}
                  onChange={(e) => setPon(e.target.value)}
                  className={inputCls}
                >
                  <option value="">-- Pilih PON --</option>
                  {Array.from({ length: ponCount }, (_, i) => i + 1).map(
                    (n) => (
                      <option key={n} value={n} disabled={usedPon.has(n)}>
                        PON {n}
                        {usedPon.has(n) ? ` — dipakai ${usedPon.get(n)}` : ""}
                      </option>
                    ),
                  )}
                </select>
              </div>

              <div>
                <span className={labelCls}>Warna Jalur</span>
                <RouteColorPicker value={color} onChange={setColor} />
              </div>

              <details className="rounded-lg border border-border p-2.5">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                  Kode:{" "}
                  <span className="font-mono text-foreground">
                    {code || "(pilih PON)"}
                  </span>{" "}
                  • {fiberCapacity} core • Ubah kabel
                </summary>
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] text-muted-foreground block">
                      Kapasitas serat
                    </span>
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
                    <span className="text-[11px] text-muted-foreground block">
                      Tipe kabel
                    </span>
                    <input
                      value={cableType}
                      onChange={(e) => setCableType(e.target.value)}
                      className={inputCls}
                    />
                  </label>
                </div>
              </details>
            </>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg border border-border text-foreground hover:bg-muted font-medium"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving || !olt || !name.trim() || !pon}
              className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Simpan & Taruh ODP
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
