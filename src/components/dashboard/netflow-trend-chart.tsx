"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatBps,
  type FlowRange,
  type NetflowTimeSeries,
} from "@/lib/dashboard/netflow";

const HEIGHT = 220;
const PAD = { top: 12, right: 16, bottom: 26, left: 64 };

function formatTick(epoch: number, range: FlowRange): string {
  const d = new Date(epoch * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return range === "7d"
    ? `${p(d.getDate())}/${p(d.getMonth() + 1)}`
    : `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatTooltipTime(epoch: number): string {
  const d = new Date(epoch * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Batas atas sumbu Y yang "bulat" (1, 2, 5 x 10^n).
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export function NetflowTrendChart({
  series,
  range,
}: {
  series: NetflowTimeSeries;
  range: FlowRange;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => setWidth(wrap.clientWidth));
    ro.observe(wrap);
    setWidth(wrap.clientWidth);
    // Ganti tema (class pada <html>) -> gambar ulang dengan warna baru.
    const mo = new MutationObserver(() => setThemeTick((t) => t + 1));
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    const style = getComputedStyle(canvas);
    const token = (name: string, fallback: string) =>
      style.getPropertyValue(name).trim() || fallback;
    const textColor = token("--muted-foreground", "#888");
    const gridColor = token("--border", "#ddd");
    const line = token("--chart-1", "#2563eb");

    const n = series.times.length;
    const plotW = width - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const max = niceMax(Math.max(0, ...series.bps));
    const x = (i: number) =>
      PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = textColor;
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;

    // Sumbu nilai.
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let g = 0; g <= 4; g++) {
      const v = (max / 4) * g;
      const gy = Math.round(y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(PAD.left, gy);
      ctx.lineTo(width - PAD.right, gy);
      ctx.stroke();
      ctx.fillText(formatBps(v), PAD.left - 6, gy);
    }

    // Sumbu waktu.
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const ticks = width < 480 ? 3 : 6;
    for (let t = 0; n > 0 && t < ticks; t++) {
      const i = Math.round((t / (ticks - 1)) * (n - 1));
      ctx.fillText(
        formatTick(series.times[i], range),
        x(i),
        HEIGHT - PAD.bottom + 8,
      );
    }

    if (n > 0) {
      // Area + kurva.
      ctx.beginPath();
      series.bps.forEach((v, i) =>
        i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)),
      );
      ctx.strokeStyle = line;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.lineTo(x(n - 1), y(0));
      ctx.lineTo(x(0), y(0));
      ctx.closePath();
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = line;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (hover !== null && hover < n) {
      ctx.strokeStyle = textColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x(hover)) + 0.5, PAD.top);
      ctx.lineTo(Math.round(x(hover)) + 0.5, PAD.top + plotH);
      ctx.stroke();
      ctx.fillStyle = line;
      ctx.beginPath();
      ctx.arc(x(hover), y(series.bps[hover]), 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [series, range, width, hover, themeTick]);

  const n = series.times.length;
  const plotW = width - PAD.left - PAD.right;

  function pick(clientX: number) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const rel = (clientX - rect.left - PAD.left) / plotW;
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  }

  const hx =
    hover === null
      ? 0
      : PAD.left + (n <= 1 ? plotW / 2 : (hover / (n - 1)) * plotW);

  return (
    <div
      ref={wrapRef}
      className="relative w-full"
      data-testid="netflow-trend-chart"
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Grafik tren throughput NetFlow, rentang ${range}`}
        style={{ width: "100%", height: HEIGHT, touchAction: "pan-y" }}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setHover(null)}
      />
      {(n === 0 || series.bps.every((b) => b === 0)) && (
        <p
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground"
          data-testid="netflow-trend-empty"
        >
          Belum ada rekaman trafik pada periode ini.
        </p>
      )}
      {hover !== null && hover < n && (
        <div
          role="status"
          className="pointer-events-none absolute top-2 z-10 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow"
          style={{
            left: hx,
            transform:
              hx > width / 2
                ? "translateX(calc(-100% - 8px))"
                : "translateX(8px)",
          }}
        >
          <div className="text-muted-foreground">
            {formatTooltipTime(series.times[hover])}
          </div>
          <div className="font-medium tabular-nums">
            {formatBps(series.bps[hover])}
          </div>
          <div className="tabular-nums">{series.flows[hover]} flow</div>
        </div>
      )}
    </div>
  );
}
