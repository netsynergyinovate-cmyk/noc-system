"use client";

import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Cable,
  ChevronRight,
  Link2,
  Loader2,
  Radio,
  RefreshCw,
  Signal,
  Users,
} from "lucide-react";
import type {
  CableRoute,
  MapDevice,
  OltDetail,
  OltRange,
} from "@/services/map/types";
import { oltPonCount, routePon } from "@/services/map/topology";
import { seriesUsageBytes } from "./traffic";
import { byteSize, TrafficChart } from "./traffic-chart";

// shortcut: kapasitas ONU per PON tetap 64 (EPON/GPON umum); ambil dari model OLT bila datanya ada di pusat
const ONU_PER_PON = 64;
const RANGES: { id: OltRange; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "1h", label: "1 jam" },
  { id: "6h", label: "6 jam" },
  { id: "24h", label: "24 jam" },
  { id: "7d", label: "7 hari" },
];
const mbps = (v: number) => `${v.toFixed(v >= 100 ? 0 : 1)} Mbps`;
const dbm = (v: number | null) => (v == null ? "-" : `${v.toFixed(2)} dBm`);
const time = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("id-ID", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "-";

type Pon = OltDetail["pons"][number];

// Warna LED port: hijau = ada ONU online, kuning = ada sinyal lemah/ONU offline, abu = kosong
function ponLed(p: Pon | undefined) {
  if (!p || p.onuOnline === 0)
    return { color: "#52525b", label: "Tidak ada ONU online" };
  if (p.weakSignal > 0 || p.onuOffline > 0)
    return { color: "#f59e0b", label: "Aktif, ada ONU bermasalah" };
  return { color: "#22c55e", label: "Aktif normal" };
}

function Led({
  color,
  label,
  blink,
}: {
  color: string;
  label: string;
  blink?: boolean;
}) {
  return (
    <span className="flex flex-col items-center gap-0.5" title={label}>
      <span
        className={`w-1.5 h-1.5 rounded-full ${blink ? "animate-pulse" : ""}`}
        style={{
          background: color,
          boxShadow: color === "#3f3f46" ? "none" : `0 0 6px ${color}`,
        }}
      />
      <span className="text-[7px] tracking-wider text-zinc-400">{label}</span>
    </span>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="p-2 rounded-lg bg-background border border-border">
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="font-mono font-bold text-foreground text-sm leading-tight">
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

interface OltViewProps {
  device: MapDevice;
  /** Jalur yang keluar dari OLT ini (PON dibaca dari kode jalur) */
  routes: CableRoute[];
  onSelectRoute: (route: CableRoute) => void;
  /** Tautkan titik ini ke OLT operasional pusat (null = lepas) */
  onLinkOlt: (deviceId: string, oltId: string | null) => Promise<void>;
}

// Panel OLT: gambar chassis + port PON, ringkasan, trafik & pemakaian per PON, dan jalur per PON
export function OltView({
  device,
  routes,
  onSelectRoute,
  onLinkOlt,
}: OltViewProps) {
  const [range, setRange] = useState<OltRange>("24h");
  const [result, setResult] = useState<{
    key: string;
    detail: OltDetail | null;
    choices: { id: string; name: string }[];
    error?: string;
  } | null>(null);
  const [selected, setSelected] = useState(1);
  const [linkPick, setLinkPick] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // shortcut: tanpa polling otomatis. Endpoint trafik VLAN pusat membaca router dan menyimpan sampel
  // tiap dipanggil (memakai cache bacaan bersama), jadi panggilan berulang mengacaukan data live/riwayat
  // pusat. Muat saat dibuka/ganti rentang/klik Muat ulang; aktifkan polling setelah pusat punya API baca-saja.
  const [refresh, setRefresh] = useState(0);
  const key = `${device.id}:${device.centralOlt?.id ?? ""}:${range}:${refresh}`;
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(
        `/api/peta/devices/${encodeURIComponent(device.id)}/olt?range=${range}`,
      )
        .then(async (res) => {
          const body = await res.json();
          if (!res.ok)
            throw new Error(body?.error?.message ?? "Gagal memuat data OLT.");
          if (alive)
            setResult({ key, detail: body.data, choices: body.choices ?? [] });
        })
        .catch((err: unknown) => {
          if (alive) {
            setResult((r) => ({
              key,
              detail: r?.key === key ? r.detail : null,
              choices: r?.choices ?? [],
              error:
                err instanceof Error ? err.message : "Gagal memuat data OLT.",
            }));
          }
        });
    load();
    return () => {
      alive = false;
    };
  }, [device.id, range, key]);

  const loading = result?.key !== key;
  const detail = result?.key === key ? result.detail : null;
  const pons = detail?.pons ?? [];
  const ponCount = Math.max(
    oltPonCount(device),
    ...pons.map((p) => p.ponIndex),
    1,
  );
  const ponOf = (n: number) => pons.find((p) => p.ponIndex === n);
  const routesOf = (n: number) => routes.filter((r) => routePon(r.code) === n);
  const usageOf = (p: Pon | undefined) =>
    p?.traffic ? seriesUsageBytes(p.traffic.series) : null;
  const sel = ponOf(selected);
  const selUsage = usageOf(sel);
  const showUsage = range !== "live";

  const totals = pons.reduce(
    (t, p) => {
      const u = usageOf(p);
      return {
        online: t.online + p.onuOnline,
        total: t.total + p.onuTotal,
        down: t.down + (p.traffic?.currentDown ?? 0),
        up: t.up + (p.traffic?.currentUp ?? 0),
        usage: t.usage + (u ? u.down + u.up : 0),
        active: t.active + (p.onuOnline > 0 ? 1 : 0),
      };
    },
    { online: 0, total: 0, down: 0, up: 0, usage: 0, active: 0 },
  );
  const sysOk =
    detail?.olt.status === "aktif" &&
    detail.olt.lastSeenAt != null &&
    detail.polledAt != null &&
    // OLT dianggap hidup bila terakhir terlihat <= 10 menit sebelum data ini diambil
    new Date(detail.polledAt).getTime() -
      new Date(detail.olt.lastSeenAt).getTime() <
      10 * 60_000;
  const alarm = pons.some((p) => p.onuOffline > 0 || p.weakSignal > 0);

  const link = async () => {
    setLinking(true);
    setLinkError(null);
    try {
      await onLinkOlt(device.id, linkPick);
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : "Gagal menautkan OLT.");
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Chassis OLT 1U: LED status dan port PON (SFP) */}
      <div className="relative rounded-xl bg-gradient-to-b from-zinc-700 via-zinc-800 to-zinc-950 border border-zinc-600 p-3 pt-2.5 text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_4px_12px_rgba(0,0,0,.35)]">
        {[
          "left-1.5 top-1.5",
          "right-1.5 top-1.5",
          "left-1.5 bottom-1.5",
          "right-1.5 bottom-1.5",
        ].map((pos) => (
          <span
            key={pos}
            aria-hidden
            className={`absolute ${pos} w-1 h-1 rounded-full bg-zinc-500`}
          />
        ))}
        <div className="flex items-start justify-between gap-2 px-1">
          <div className="min-w-0">
            <div className="text-[9px] font-bold tracking-[0.2em] text-zinc-400 uppercase">
              {detail?.olt.brand ?? "OLT"}
            </div>
            <div className="text-xs font-semibold text-zinc-100 truncate">
              {detail?.olt.name ?? device.name}
            </div>
            <div className="text-[9px] font-mono text-zinc-500">
              {ponCount} PON
            </div>
          </div>
          <div className="flex gap-2 pt-0.5">
            <Led color="#22c55e" label="PWR" />
            <Led
              color={detail ? (sysOk ? "#22c55e" : "#f59e0b") : "#3f3f46"}
              label="SYS"
              blink={!!detail && sysOk}
            />
            <Led color={alarm ? "#ef4444" : "#3f3f46"} label="ALM" />
          </div>
        </div>

        <div
          className="mt-2.5 grid gap-1.5 rounded-lg bg-zinc-950/70 border border-zinc-700 p-2"
          style={{
            gridTemplateColumns: `repeat(${Math.min(ponCount, 8)}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: ponCount }, (_, i) => i + 1).map((n) => {
            const p = ponOf(n);
            const led = ponLed(p);
            const active = selected === n;
            const jalur = routesOf(n).length;
            return (
              <button
                key={n}
                type="button"
                onClick={() => setSelected(n)}
                aria-pressed={active}
                aria-label={`PON ${n}: ${led.label}, ${p?.onuOnline ?? 0} ONU online, ${jalur} jalur`}
                title={`PON ${n} • ${led.label} • ${p?.onuOnline ?? 0} ONU online • ${jalur} jalur`}
                className={`flex flex-col items-center gap-1 rounded-md py-1 transition-colors ${
                  active
                    ? "bg-sky-500/20 ring-1 ring-sky-400"
                    : "hover:bg-zinc-800"
                }`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background: led.color,
                    boxShadow: `0 0 5px ${led.color}`,
                  }}
                />
                {/* Sangkar SFP dengan kontak emas */}
                <span className="w-7 h-5 rounded-[3px] bg-zinc-900 border border-zinc-500 flex items-end justify-center gap-[2px] pb-[3px]">
                  {[0, 1, 2, 3].map((k) => (
                    <span
                      key={k}
                      className="w-[3px] h-1.5 bg-amber-400/80 rounded-[1px]"
                    />
                  ))}
                </span>
                <span className="text-[8px] font-mono font-bold text-zinc-300">
                  PON{n}
                </span>
                <span
                  className={`text-[8px] font-mono ${jalur ? "text-sky-300" : "text-zinc-600"}`}
                  aria-hidden
                >
                  {jalur ? `${jalur} jl` : "–"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-between px-1 pt-1.5 text-[8px] text-zinc-500">
          <span>Data {time(detail?.polledAt ?? null)}</span>
          <span>OLT terlihat {time(detail?.olt.lastSeenAt ?? null)}</span>
        </div>
      </div>

      {/* Belum tertaut ke OLT operasional: pilih dari daftar pusat */}
      {!loading && !detail && (
        <div className="p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/5 space-y-1.5">
          <p className="text-[11px] text-foreground flex items-center gap-1.5">
            <Link2 className="w-3.5 h-3.5 text-amber-500" />
            Titik ini belum ditautkan ke OLT operasional, jadi data PON & trafik
            belum tampil.
          </p>
          {result?.choices.length ? (
            <div className="flex gap-2">
              <select
                value={linkPick}
                onChange={(e) => setLinkPick(e.target.value)}
                aria-label="Pilih OLT operasional"
                className="flex-1 min-w-0 bg-background border border-border rounded px-2 py-1 text-xs"
              >
                <option value="">-- Pilih OLT --</option>
                {result.choices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={link}
                disabled={!linkPick || linking}
                className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1 disabled:opacity-50"
              >
                {linking && <Loader2 className="w-3 h-3 animate-spin" />}{" "}
                Tautkan
              </button>
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              Tidak ada OLT operasional di NOC.
            </p>
          )}
          {linkError && (
            <p className="text-[11px] text-destructive">{linkError}</p>
          )}
        </div>
      )}

      {result?.error && (
        <p className="text-[11px] text-destructive">{result.error}</p>
      )}
      {detail && detail.unavailable.length > 0 && (
        <p className="text-[11px] text-amber-500">
          Sebagian data tidak tersedia: {detail.unavailable.join(", ")}.
        </p>
      )}

      {detail && (
        <>
          {/* Ringkasan */}
          <div className="grid grid-cols-2 gap-2">
            <Stat
              icon={<Users className="w-3 h-3" />}
              label="ONU online"
              value={`${totals.online}/${totals.total}`}
              sub={`${totals.active} dari ${ponCount} PON aktif`}
            />
            <Stat
              icon={<ArrowDown className="w-3 h-3 text-blue-400" />}
              label="Trafik sekarang"
              value={mbps(totals.down)}
              sub={`↑ ${mbps(totals.up)}`}
            />
            <Stat
              icon={<Signal className="w-3 h-3" />}
              label="ONU bermasalah"
              value={String(
                pons.reduce((s, p) => s + p.onuOffline + p.weakSignal, 0),
              )}
              sub="offline + sinyal lemah"
            />
            <Stat
              icon={<ArrowUp className="w-3 h-3 text-orange-400" />}
              label={
                showUsage
                  ? `Pemakaian ${RANGES.find((r) => r.id === range)?.label}`
                  : "Pemakaian"
              }
              value={showUsage ? byteSize(totals.usage) : "-"}
              sub={showUsage ? "download + upload" : "pilih rentang waktu"}
            />
          </div>

          {/* Rentang waktu trafik + muat ulang manual */}
          <div className="flex gap-1.5 items-center">
            <div
              role="radiogroup"
              aria-label="Rentang waktu trafik"
              className="flex-1 flex gap-1 p-0.5 rounded-lg bg-muted/60"
            >
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={range === r.id}
                  onClick={() => setRange(r.id)}
                  className={`flex-1 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    range === r.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setRefresh((n) => n + 1)}
              disabled={loading}
              title="Muat ulang data OLT"
              aria-label="Muat ulang data OLT"
              className="p-1.5 rounded-lg border border-border bg-background hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </>
      )}

      {/* Tabel semua PON */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="grid grid-cols-[3.2rem_1fr_4.6rem_4.2rem] gap-2 px-2 py-1.5 bg-muted/60 text-[9px] uppercase tracking-wide text-muted-foreground">
          <span>Port</span>
          <span>ONU</span>
          <span className="text-right">Trafik ↓</span>
          <span className="text-right">
            {showUsage ? "Pemakaian" : "Rx PON"}
          </span>
        </div>
        {Array.from({ length: ponCount }, (_, i) => i + 1).map((n) => {
          const p = ponOf(n);
          const u = usageOf(p);
          const fill = Math.min(
            100,
            ((p?.onuTotal || p?.onuOnline || 0) / ONU_PER_PON) * 100,
          );
          return (
            <button
              key={n}
              type="button"
              onClick={() => setSelected(n)}
              className={`w-full grid grid-cols-[3.2rem_1fr_4.6rem_4.2rem] gap-2 items-center px-2 py-1.5 border-t border-border/60 text-left text-[11px] ${
                selected === n ? "bg-primary/10" : "hover:bg-muted/50"
              }`}
            >
              <span className="flex items-center gap-1 font-mono font-semibold text-foreground">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: ponLed(p).color }}
                />
                PON{n}
              </span>
              <span className="min-w-0">
                <span className="block font-mono text-foreground">
                  {p ? `${p.onuOnline}/${p.onuTotal || p.onuOnline}` : "-"}
                  <span className="text-muted-foreground"> /{ONU_PER_PON}</span>
                </span>
                <span className="block h-1 rounded-full bg-muted overflow-hidden">
                  <span
                    className="block h-full bg-emerald-500"
                    style={{ width: `${fill}%` }}
                  />
                </span>
              </span>
              <span className="text-right font-mono text-foreground">
                {p?.traffic ? mbps(p.traffic.currentDown) : "-"}
              </span>
              <span className="text-right font-mono text-muted-foreground">
                {showUsage
                  ? u
                    ? byteSize(u.down + u.up)
                    : "-"
                  : dbm(p?.rxPower ?? null)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Rincian PON terpilih */}
      <div className="p-3 rounded-xl bg-muted/30 border border-border space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-medium text-foreground flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-sky-500" />
            PON {selected}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: ponLed(sel).color }}
            />
            {ponLed(sel).label}
          </span>
        </div>

        {loading && !detail && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" /> Memuat data OLT...
          </p>
        )}

        {sel?.traffic && (
          <TrafficChart
            points={sel.traffic.series.map((p) => ({
              t: p.t,
              down: p.down * 1e6,
              up: p.up * 1e6,
            }))}
          />
        )}

        {sel && (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            {(
              [
                ["Rx PON", dbm(sel.rxPower)],
                ["Tx PON", dbm(sel.txPower)],
                ["ONU online", `${sel.onuOnline}`],
                ["ONU offline", `${sel.onuOffline}`],
                ["ONU terdaftar", `${sel.onuTotal} / ${ONU_PER_PON}`],
                ["Sinyal lemah (< -27)", `${sel.weakSignal}`],
                ["Rata-rata Rx ONU", dbm(sel.avgOnuRx)],
                [
                  "Trafik sekarang",
                  sel.traffic
                    ? `↓ ${mbps(sel.traffic.currentDown)} ↑ ${mbps(sel.traffic.currentUp)}`
                    : "-",
                ],
                [
                  "Puncak",
                  sel.traffic
                    ? `↓ ${mbps(sel.traffic.peakDown)} ↑ ${mbps(sel.traffic.peakUp)}`
                    : "-",
                ],
                [
                  "Rata-rata",
                  sel.traffic
                    ? `↓ ${mbps(sel.traffic.avgDown)} ↑ ${mbps(sel.traffic.avgUp)}`
                    : "-",
                ],
                [
                  showUsage
                    ? `Pemakaian ${RANGES.find((r) => r.id === range)?.label}`
                    : "Pemakaian",
                  showUsage && selUsage
                    ? `↓ ${byteSize(selUsage.down)} ↑ ${byteSize(selUsage.up)}`
                    : "-",
                ],
                [
                  "Total sejak router menyala",
                  sel.traffic
                    ? `↓ ${byteSize(sel.traffic.downTotalBytes)} ↑ ${byteSize(sel.traffic.upTotalBytes)}`
                    : "-",
                ],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between gap-2 py-0.5 border-b border-border/50"
              >
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono text-foreground text-right">
                  {value}
                </span>
              </div>
            ))}
          </div>
        )}
        {!loading && detail && !sel && (
          <p className="text-[11px] text-muted-foreground">
            Port ini belum dipakai.
          </p>
        )}

        {/* Jalur kabel yang keluar dari PON ini */}
        <div className="pt-1 space-y-1">
          <div className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
            <Cable className="w-3 h-3" /> Jalur dari PON {selected} (
            {routesOf(selected).length})
          </div>
          {routesOf(selected).length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic">
              Belum ada jalur yang tercatat di PON ini.
            </p>
          ) : (
            routesOf(selected).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelectRoute(r)}
                className="w-full flex items-center gap-2 p-1.5 rounded-lg bg-background border border-border/60 hover:bg-muted text-left"
              >
                <span
                  className="w-1 self-stretch rounded"
                  style={{ background: r.color ?? "#3b82f6" }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-medium text-foreground truncate">
                    {r.name}
                  </span>
                  <span className="block text-[10px] font-mono text-muted-foreground truncate">
                    {r.code}
                  </span>
                </span>
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
