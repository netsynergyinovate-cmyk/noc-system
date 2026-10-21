"use client";

import { niceStep, type TrafficPoint } from "./traffic";

export const bitRate = (bps: number) =>
  bps >= 1e6 ? `${(bps / 1e6).toFixed(2)} Mbps` : `${(bps / 1e3).toFixed(1)} kbps`;
export const byteSize = (b: number) =>
  b >= 1e12
    ? `${(b / 1e12).toFixed(2)} TB`
    : b >= 1e9
      ? `${(b / 1e9).toFixed(2)} GB`
      : `${(b / 1e6).toFixed(1)} MB`;

// Label sumbu ringkas: "2.5M", "500k"
const axisRate = (bps: number) =>
  bps === 0 ? "0" : bps >= 1e6 ? `${+(bps / 1e6).toFixed(2)}M` : `${+(bps / 1e3).toFixed(1)}k`;
const clock = (t: number) =>
  new Date(t).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// Grafik ala Winbox: download biru berisi, upload oranye, garis bantu di nilai bulat
export function TrafficChart({ points }: { points: TrafficPoint[] }) {
  const peak = Math.max(1000, ...points.map((p) => Math.max(p.down, p.up)));
  const step = niceStep(peak);
  const top = step * 4;
  const x = (i: number) => (i / Math.max(1, points.length - 1)) * 100;
  const y = (v: number) => 100 - (v / top) * 100;
  const line = (k: "down" | "up") => points.map((p, i) => `${x(i)},${y(p[k])}`).join(" ");
  const last = points.at(-1);
  // Label waktu di 0%, 50%, 100% lebar grafik
  // Set: dengan 2-3 titik, posisi 50% bisa jatuh di indeks yang sama dengan ujungnya
  const timeTicks =
    points.length > 1 ? [...new Set([0, 0.5, 1].map((f) => Math.round(f * (points.length - 1))))] : [];

  return (
    <div className="rounded-lg bg-zinc-950 border border-zinc-800 p-2 pb-1 space-y-1.5">
      <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-300">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-0.5 rounded bg-blue-400" /> Download
          <b className="text-blue-300">{last ? bitRate(last.down) : "-"}</b>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-0.5 rounded bg-orange-400" /> Upload
          <b className="text-orange-300">{last ? bitRate(last.up) : "-"}</b>
        </span>
      </div>
      <div className="flex gap-1.5">
        {/* Sumbu Y */}
        <div className="relative w-9 h-32 shrink-0 text-[9px] font-mono text-zinc-500 text-right">
          {[4, 3, 2, 1, 0].map((n) => (
            <span key={n} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(step * n)}%` }}>
              {axisRate(step * n)}
            </span>
          ))}
        </div>
        <div className="flex-1 min-w-0">
          <div className="relative h-32">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
              {[0, 1, 2, 3, 4].map((n) => (
                <line
                  key={n}
                  x1="0"
                  x2="100"
                  y1={y(step * n)}
                  y2={y(step * n)}
                  stroke={n === 0 ? "#52525b" : "#27272a"}
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {timeTicks.map((i) => (
                <line key={i} x1={x(i)} x2={x(i)} y1="0" y2="100" stroke="#27272a" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
              {points.length > 1 && (
                <>
                  <polygon points={`0,100 ${line("down")} 100,100`} fill="#60a5fa" fillOpacity="0.12" />
                  <polyline
                    points={line("down")}
                    fill="none"
                    stroke="#60a5fa"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polyline
                    points={line("up")}
                    fill="none"
                    stroke="#fb923c"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              )}
            </svg>
            {points.length < 2 && (
              <span className="absolute inset-0 flex items-center justify-center text-[11px] text-zinc-500">
                Mengumpulkan data...
              </span>
            )}
          </div>
          {/* Sumbu X */}
          <div className="relative h-3.5 text-[9px] font-mono text-zinc-500">
            {timeTicks.map((i, n) => (
              <span
                key={i}
                className={`absolute top-0.5 ${n === 0 ? "" : n === timeTicks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
                style={{ left: `${x(i)}%` }}
              >
                {clock(points[i].t)}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

