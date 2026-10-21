"use client";

import { useState } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { MapDevice } from "@/services/map/types";
import { portCount } from "@/services/map/loss-budget";

/** Isi satu port: pelanggan (di ODP) atau ODP (di ODC) */
export interface PortItem {
  id: string;
  name: string;
  sub: string;
  port: number | null | undefined;
  color: string;
  /** Ikon status, agar status tidak dibedakan lewat warna saja */
  Icon: LucideIcon;
}

interface PortBoxProps {
  /** ODC atau ODP yang digambar */
  box: MapDevice;
  items: PortItem[];
  /** "pelanggan" | "ODP", untuk teks */
  itemLabel: string;
  legend: { label: string; color: string; Icon: LucideIcon }[];
  /** Jumlah port yang digambar; bawaan = rasio splitter / kapasitas kotak */
  ports?: number;
  /** Pilihan tambahan untuk port kosong yang belum menjadi isi kotak ini (mis. ODP lain untuk ODC) */
  candidates?: { id: string; name: string; sub: string }[];
  onSetPort: (itemId: string, port: number | null) => Promise<void>;
  onOpen: (itemId: string) => void;
}

const MAX_PORTS = 64; // batas gambar; kotak lebih besar dari ini tak muat di panel

// Gambar kotak ODC/ODP: baris adaptor port (1..rasio splitter) dan kabel ke isi yang dicatat di port itu
export function PortBox({ box, items, itemLabel, legend, ports, candidates = [], onSetPort, onOpen }: PortBoxProps) {
  const total = Math.min(ports ?? portCount(box), MAX_PORTS);
  const byPort = new Map(
    items.filter((c) => c.port != null && c.port <= total).map((c) => [c.port!, c]),
  );
  const unassigned = items.filter((c) => byPort.get(c.port ?? 0) !== c);
  const [active, setActive] = useState<number | null>(null);
  const [pick, setPick] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (total === 0) {
    return (
      <p className="text-[11px] text-muted-foreground italic">
        Rasio splitter belum diisi, jadi kotak port belum bisa digambar.
      </p>
    );
  }

  const save = async (itemId: string, port: number | null) => {
    setSaving(true);
    setError(null);
    try {
      await onSetPort(itemId, port);
      setActive(null);
      setPick("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan port.");
    } finally {
      setSaving(false);
    }
  };

  const cols = Math.min(total, 8);
  const activeItem = active !== null ? byPort.get(active) : undefined;

  return (
    <div className="space-y-2">
      {/* Badan kotak */}
      <div className="rounded-xl border-2 border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800/80 p-2 shadow-inner">
        <div className="flex items-center justify-between gap-2 rounded-md bg-zinc-200 dark:bg-zinc-700/70 px-2 py-1 mb-2 text-[10px]">
          <span className="font-semibold text-zinc-700 dark:text-zinc-200 truncate">{box.name}</span>
          <span className="font-mono text-zinc-500 dark:text-zinc-400 shrink-0">
            {ports != null
              ? `${total} port ${itemLabel}`
              : box.splitterRatio
                ? `Splitter 1:${box.splitterRatio}`
                : `${total} port (rasio belum diisi)`}{" "}
            •{" "}
            {byPort.size}/{total} terpakai
          </span>
        </div>

        <div className="grid gap-x-1 gap-y-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {Array.from({ length: total }, (_, i) => i + 1).map((port) => {
            const c = byPort.get(port);
            const isActive = active === port;
            return (
              <button
                key={port}
                type="button"
                onClick={() => {
                  setActive(isActive ? null : port);
                  setPick("");
                  setError(null);
                }}
                aria-label={c ? `Port ${port}: ${c.name}` : `Port ${port}: kosong`}
                aria-pressed={isActive}
                title={c ? `Port ${port} • ${c.name}` : `Port ${port} • kosong`}
                className={`flex flex-col items-center rounded-md pt-1 pb-0.5 transition-colors ${
                  isActive ? "bg-primary/15 ring-1 ring-primary" : "hover:bg-zinc-200 dark:hover:bg-zinc-700"
                }`}
              >
                {/* Adaptor SC: biru bila terisi, kotak putus-putus bila kosong */}
                <span
                  className={`w-5 h-6 rounded-sm flex items-start justify-center ${
                    c ? "bg-blue-600 shadow" : "border border-dashed border-zinc-400 dark:border-zinc-500"
                  }`}
                >
                  {c && <span className="mt-0.5 w-2.5 h-2.5 rounded-[2px] bg-yellow-300" />}
                </span>
                {/* Kabel keluar ke isi port, berujung ikon status */}
                <span className="w-1 h-3 rounded-b" style={{ background: c ? c.color : "transparent" }} />
                {c ? (
                  <c.Icon aria-hidden className="w-3 h-3 -mt-0.5" style={{ color: c.color }} strokeWidth={2.5} />
                ) : (
                  <span className="w-3 h-3 -mt-0.5" />
                )}
                <span className="text-[9px] font-mono text-zinc-500 dark:text-zinc-400 leading-none">{port}</span>
                <span className="w-full px-0.5 text-[8px] leading-tight text-center text-zinc-700 dark:text-zinc-300 truncate">
                  {c ? c.name : " "}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {legend.map((l) => (
          <span key={l.label} className="flex items-center gap-1">
            <l.Icon aria-hidden className="w-3 h-3" style={{ color: l.color }} strokeWidth={2.5} /> {l.label}
          </span>
        ))}
      </div>

      {/* Aksi port terpilih */}
      {active !== null && (
        <div className="p-2 rounded-lg bg-background border border-border space-y-1.5">
          <div className="font-medium text-foreground">Port {active}</div>
          {activeItem ? (
            <>
              <div className="flex items-center gap-1.5">
                <activeItem.Icon aria-hidden className="w-3.5 h-3.5" style={{ color: activeItem.color }} strokeWidth={2.5} />
                <span className="text-foreground">{activeItem.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{activeItem.sub}</span>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => save(activeItem.id, null)}
                  className="px-2.5 py-1 rounded text-rose-500 hover:bg-rose-500/10 flex items-center gap-1"
                >
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />} Lepas port
                </button>
                <button
                  type="button"
                  onClick={() => onOpen(activeItem.id)}
                  className="px-2.5 py-1 rounded bg-primary text-primary-foreground font-medium"
                >
                  Buka detail
                </button>
              </div>
            </>
          ) : unassigned.length + candidates.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              Port kosong. Semua {itemLabel} di sini sudah punya port.
            </p>
          ) : (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (pick) save(pick, active);
              }}
            >
              <select
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                aria-label={`Pilih ${itemLabel} untuk port ${active}`}
                className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-1 text-xs"
              >
                <option value="">-- Pilih {itemLabel} --</option>
                {unassigned.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                {candidates.length > 0 && (
                  <optgroup label="Lainnya (terdekat dulu)">
                    {candidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.sub && `• ${c.sub}`}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button
                type="submit"
                disabled={!pick || saving}
                className="px-3 py-1 rounded bg-primary text-primary-foreground font-medium flex items-center gap-1 disabled:opacity-50"
              >
                {saving && <Loader2 className="w-3 h-3 animate-spin" />} Pasang
              </button>
            </form>
          )}
          {error && <p className="text-[11px] text-destructive">{error}</p>}
        </div>
      )}

      {unassigned.length > 0 && (
        <p className="text-[11px] text-amber-500">
          {unassigned.length} {itemLabel} belum dicatat port-nya. Klik port kosong untuk memasangnya.
        </p>
      )}
    </div>
  );
}
