"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { TRAFFIC_WINDOW } from "@/lib/dashboard/constants";
import { incidentLabels } from "@/lib/dashboard/incidents";
import { getRange, type TrafficRangeId } from "@/lib/dashboard/ranges";
import { useDashboardStore } from "@/lib/dashboard/store";
import {
  TRAFFIC_GAP_SECONDS,
  trafficMarks,
  trafficPointNote,
} from "@/lib/dashboard/traffic-marks";
import type { Incident, TrafficSeries } from "@/lib/dashboard/types";
import { getResolvedTheme, subscribeTheme } from "@/lib/theme";

const MIN_HEIGHT = 256;
const FONT = "12px Arial, Helvetica, sans-serif";
const DAY = 24 * 3600;
// Lama gulir halus antar-sampel live (sampel datang tiap ~1 detik).
const SCROLL_MS = 1000;

// Data histori yang statis; tanpa ini grafik memakai data langsung dari store.
export interface HistoryWindow {
  series: TrafficSeries;
  from: number;
  to: number;
}

function readLiveData(): uPlot.AlignedData {
  const { times, rx, tx } = useDashboardStore.getState().traffic;
  return [times, rx, tx];
}

// Jam 24 format Indonesia (uPlot bawaannya AM/PM Inggris).
const fmt = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("id-ID", { hour12: false, ...options });
const secondsFormat = fmt({
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const minutesFormat = fmt({ hour: "2-digit", minute: "2-digit" });
const dateFormat = fmt({ day: "numeric", month: "short" });
const dateTimeFormat = fmt({
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const mbpsFormat = new Intl.NumberFormat("id-ID", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

// Label sumbu waktu menyesuaikan rentang: detik untuk beberapa menit terakhir,
// jam dan menit untuk hari ini, tanggal untuk berhari-hari.
function axisLabels(rangeSeconds: number, splits: number[]) {
  const step = splits.length > 1 ? splits[1] - splits[0] : 1;
  let format = step % 60 === 0 ? minutesFormat : secondsFormat;
  if (rangeSeconds > 2 * DAY)
    format = step >= DAY ? dateFormat : dateTimeFormat;
  return splits.map((time) => format.format(new Date(time * 1000)));
}

interface BandColors {
  info: string;
  warning: string;
  critical: string;
}

// Pita vertikal untuk tiap insiden, digambar di belakang garis. Garis tebal di
// bagian atas pita menandai awalnya; yang kritis memakai garis penuh dan yang
// peringatan putus-putus, jadi tingkatnya terbaca tanpa bergantung pada warna.
function incidentBandsPlugin(
  getIncidents: () => Incident[],
  colors: BandColors,
): uPlot.Plugin {
  return {
    hooks: {
      drawClear: [
        (u) => {
          const min = u.scales.x.min;
          const max = u.scales.x.max;
          if (min == null || max == null) return;
          const { ctx } = u;
          const { left, top, width, height } = u.bbox;
          const ratio = window.devicePixelRatio || 1;
          ctx.save();
          ctx.beginPath();
          ctx.rect(left, top, width, height);
          ctx.clip();
          for (const incident of getIncidents()) {
            const end = incident.endedAt ?? max;
            if (end < min || incident.startedAt > max) continue;
            const x0 = u.valToPos(Math.max(incident.startedAt, min), "x", true);
            const x1 = u.valToPos(Math.min(end, max), "x", true);
            const bandWidth = Math.max(x1 - x0, 3 * ratio);
            const color = colors[incident.severity];
            ctx.fillStyle = `${color}29`;
            ctx.fillRect(x0, top, bandWidth, height);
            ctx.strokeStyle = color;
            ctx.lineWidth = 3 * ratio;
            ctx.setLineDash(
              incident.severity === "critical" ? [] : [6 * ratio, 4 * ratio],
            );
            ctx.beginPath();
            ctx.moveTo(x0, top + 1.5 * ratio);
            ctx.lineTo(x0 + bandWidth, top + 1.5 * ratio);
            ctx.stroke();
          }
          ctx.restore();
        },
      ],
    },
  };
}

// Penanda titik 0/0 dan celah data di grafik live; arti dan batasnya di
// lib/dashboard/traffic-marks.ts. Terbaca tanpa warna: celah = pita bertepi
// putus-putus berlabel "N dtk" (garisnya juga terputus), 0/0 = cincin berlabel "0".
// Penanda baru muncul perlahan (fadeMs; 0 bila pengguna memilih gerak dikurangi).
function trafficMarksPlugin(
  colors: { zero: string; gap: string; label: string },
  fadeMs: number,
): uPlot.Plugin {
  const firstSeen = new Map<string, number>();
  return {
    hooks: {
      draw: [
        (u) => {
          const [times, rx, tx] = u.data as unknown as number[][];
          const marks = trafficMarks(times, rx, tx);
          if (marks.length === 0) return;
          const { ctx } = u;
          const { left, top, width, height } = u.bbox;
          const ratio = window.devicePixelRatio || 1;
          const now = performance.now();
          const keys = new Set<string>();
          let fading = false;
          ctx.save();
          ctx.beginPath();
          ctx.rect(left, top, width, height);
          ctx.clip();
          ctx.font = `${10 * ratio}px Arial, Helvetica, sans-serif`;
          ctx.textAlign = "center";
          for (const mark of marks) {
            const key = mark.kind === "gap" ? `g${mark.from}` : `z${mark.time}`;
            keys.add(key);
            const seen = firstSeen.get(key) ?? now;
            firstSeen.set(key, seen);
            const alpha = fadeMs > 0 ? Math.min(1, (now - seen) / fadeMs) : 1;
            if (alpha < 1) fading = true;
            ctx.globalAlpha = alpha;
            if (mark.kind === "gap") {
              const x0 = u.valToPos(mark.from, "x", true);
              const x1 = u.valToPos(mark.to, "x", true);
              const band = ctx.createLinearGradient(0, top, 0, top + height);
              band.addColorStop(0, `${colors.gap}40`);
              band.addColorStop(1, `${colors.gap}05`);
              ctx.fillStyle = band;
              ctx.fillRect(x0, top, x1 - x0, height);
              ctx.strokeStyle = `${colors.gap}aa`;
              ctx.lineWidth = ratio;
              ctx.setLineDash([3 * ratio, 3 * ratio]);
              ctx.beginPath();
              ctx.moveTo(x0, top);
              ctx.lineTo(x0, top + height);
              ctx.moveTo(x1, top);
              ctx.lineTo(x1, top + height);
              ctx.stroke();
              ctx.setLineDash([]);
              if (x1 - x0 >= 34 * ratio) {
                ctx.fillStyle = colors.label;
                ctx.fillText(
                  `${mark.to - mark.from - 1} dtk`,
                  (x0 + x1) / 2,
                  top + 12 * ratio,
                );
              }
              continue;
            }
            const x = u.valToPos(mark.time, "x", true);
            const y = u.valToPos(0, "y", true) - 7 * ratio;
            ctx.fillStyle = `${colors.zero}33`;
            ctx.beginPath();
            ctx.arc(x, y, 8 * ratio, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = colors.zero;
            ctx.lineWidth = 2 * ratio;
            ctx.beginPath();
            ctx.arc(x, y, 4 * ratio, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.fillStyle = colors.zero;
            ctx.fillText("0", x, y - 11 * ratio);
          }
          ctx.restore();
          for (const key of firstSeen.keys()) {
            if (!keys.has(key)) firstSeen.delete(key);
          }
          if (fading) requestAnimationFrame(() => u.redraw(false));
        },
      ],
    },
  };
}

// Titik yang sedang dibaca pengguna. Data live bergeser di bawah kursor yang diam;
// tanpa pin, titik yang ditunjuk berganti tiap detik saat kursor ditahan (bug "di-hold").
interface CursorPin {
  time: number | null;
  left: number | null;
}

// Pindahkan kursor ke posisi baru titik yang dipin (setelah skala x berubah).
function followPin(u: uPlot, pin: CursorPin) {
  if (pin.time == null || u.cursor.top == null) return;
  const x = u.valToPos(pin.time, "x");
  if (x < 0 || x > u.over.clientWidth) return; // sudah keluar jendela: dilepas di hook
  pin.left = x;
  u.setCursor({ left: x, top: u.cursor.top });
}

export interface InspectedTrafficPoint {
  time: number;
  rx: number;
  tx: number;
  // Penjelasan titik 0/0 atau celah sebelum titik ini (hanya grafik live).
  note?: string | null;
}

// Kotak info yang mengikuti kursor. Diisi langsung ke DOM (bukan state React)
// dan hanya memakai textContent. Bila kursor berada pada insiden, namanya
// ditampilkan juga.
function tooltipPlugin(
  rangeSeconds: number,
  getIncidents: () => Incident[],
  pin: CursorPin,
  noteColor: string,
  onInspect?: (point: InspectedTrafficPoint | null) => void,
  live = false,
): uPlot.Plugin {
  let tip: HTMLDivElement;
  const lines = (["time", "rx", "tx", "incident", "note"] as const).map(() =>
    document.createElement("div"),
  );
  const timeFormat = rangeSeconds > DAY ? dateTimeFormat : secondsFormat;
  return {
    hooks: {
      init: (u) => {
        tip = document.createElement("div");
        tip.className = "traffic-tip";
        tip.hidden = true;
        tip.append(...lines);
        lines[4].style.color = noteColor;
        u.over.appendChild(tip);

        const over = u.over;
        over.addEventListener("mouseleave", () => {
          pin.time = pin.left = null;
          tip.hidden = true;
          onInspect?.(null);
        });
        // Tahan dan geser (mouse) tidak boleh menyeleksi teks halaman; tekan lama
        // di layar sentuh tidak memunculkan menu salin.
        over.style.userSelect = "none";
        over.style.setProperty("-webkit-touch-callout", "none");
        // uPlot hanya mendengar mouse. Sentuhan: geser mendatar = membaca titik,
        // geser tegak tetap menggulir halaman; diangkat = kotak info hilang.
        over.style.touchAction = "pan-y";
        const touchAt = (e: PointerEvent) => {
          if (e.pointerType === "mouse") return;
          const box = over.getBoundingClientRect();
          u.setCursor({ left: e.clientX - box.left, top: e.clientY - box.top });
        };
        const touchEnd = (e: PointerEvent) => {
          if (e.pointerType !== "mouse") u.setCursor({ left: -10, top: -10 });
        };
        over.addEventListener("pointerdown", touchAt);
        over.addEventListener("pointermove", touchAt);
        over.addEventListener("pointerup", touchEnd);
        over.addEventListener("pointercancel", touchEnd);
        // Tanpa ini browser mengirim mouse tiruan setelah jari diangkat, kursor
        // muncul lagi dan tidak pernah "keluar" (kotak info menempel).
        over.addEventListener("touchend", (e) => e.preventDefault(), {
          passive: false,
        });
      },
      setCursor: (u) => {
        const { idx, left, top } = u.cursor;
        if (idx == null || left == null || top == null || left < 0) {
          pin.time = pin.left = null;
          tip.hidden = true;
          onInspect?.(null);
          return;
        }
        const [times, rx, tx] = u.data;
        if (pin.time != null && left === pin.left && times[idx] !== pin.time) {
          // Kursor tidak digerakkan, datanya yang bergeser: ikuti titik yang sedang dibaca.
          const x = u.valToPos(pin.time, "x");
          if (x >= 0 && x <= u.over.clientWidth) {
            pin.left = x;
            u.setCursor({ left: x, top });
            return;
          }
        }
        pin.time = times[idx] ?? null;
        pin.left = left;
        const t = times[idx] ?? 0;
        const r = rx[idx] ?? 0;
        const x = tx[idx] ?? 0;

        lines[0].textContent = `${timeFormat.format(new Date(t * 1000))} WIB`;
        lines[1].textContent = `Unduh ${mbpsFormat.format(r)} Mbps`;
        lines[2].textContent = `Unggah ${mbpsFormat.format(x)} Mbps`;

        // Toleransi 4 px supaya insiden yang sangat singkat tetap bisa ditunjuk.
        const min = u.scales.x.min ?? 0;
        const max = u.scales.x.max ?? 0;
        const slack = ((max - min) / Math.max(u.over.clientWidth, 1)) * 4;
        const at = u.posToVal(left, "x");
        const hit = getIncidents().find(
          (incident) =>
            at >= incident.startedAt - slack &&
            at <= (incident.endedAt ?? max) + slack,
        );
        lines[3].textContent = hit
          ? `Insiden: ${incidentLabels[hit.kind]}`
          : "";
        lines[3].hidden = !hit;

        const note = live
          ? trafficPointNote(
              times as number[],
              rx as number[],
              tx as number[],
              idx,
            )
          : null;
        lines[4].textContent = note ?? "";
        lines[4].hidden = !note;

        tip.hidden = false;
        const flip = left > u.over.clientWidth / 2;
        tip.style.left = flip ? "auto" : `${left + 14}px`;
        tip.style.right = flip ? `${u.over.clientWidth - left + 14}px` : "auto";
        tip.style.top = `${Math.max(
          0,
          Math.min(top - 12, u.over.clientHeight - tip.offsetHeight),
        )}px`;

        onInspect?.({ time: t, rx: r, tx: x, note });
      },
    },
  };
}

// Grafik digambar di canvas. Pada rentang "live", data baru masuk lewat setData
// di requestAnimationFrame tanpa state React, jadi tidak ada re-render per
// detik. Pada rentang histori, datanya tetap dan digambar sekali.
export function TrafficChart({
  rangeId,
  history,
  incidents,
  onInspect,
  followLive = true,
  label,
}: {
  rangeId: TrafficRangeId;
  history?: HistoryWindow;
  incidents: Incident[];
  onInspect?: (point: InspectedTrafficPoint | null) => void;
  // false: histori ini bukan trafik router (mis. satu pelanggan), jadi titik live
  // dari store dashboard tidak ditempelkan ke ujung grafik.
  followLive?: boolean;
  // Rentang untuk label aksesibel bila berbeda dari rangeId (mis. "30 hari").
  label?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);
  const incidentsRef = useRef<Incident[]>(incidents);
  const historyRef = useRef<HistoryWindow | undefined>(history);
  const onInspectRef = useRef(onInspect);
  useEffect(() => {
    onInspectRef.current = onInspect;
  });

  // Warna canvas dibaca saat grafik dibuat, jadi grafik dibuat ulang saat tema berganti.
  const theme = useSyncExternalStore(
    subscribeTheme,
    getResolvedTheme,
    () => "light",
  );

  // Insiden berubah (mis. pembaruan berkala) tanpa membuat ulang grafik.
  useEffect(() => {
    incidentsRef.current = incidents;
    chartRef.current?.redraw(false);
  }, [incidents]);

  // Saat histori diperbarui (mis. auto-refresh berkala), perbarui data kanvas tanpa merusak uPlot
  useEffect(() => {
    historyRef.current = history;
    if (history && chartRef.current) {
      chartRef.current.setData([
        history.series.times,
        history.series.rx,
        history.series.tx,
      ]);
    }
  }, [history]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const rangeSeconds = getRange(rangeId).seconds;
    historyRef.current = history;
    let disposed = false;
    let cleanup = () => {};

    // uPlot butuh `document` saat dimuat, jadi hanya diimpor di browser.
    import("uplot").then(({ default: UPlot }) => {
      if (disposed) return;
      const style = getComputedStyle(container);
      const token = (name: string) => style.getPropertyValue(name).trim();
      const text = token("--muted-foreground");
      const grid = { stroke: token("--border"), width: 1 };
      const download = token("--chart-1");
      const upload = token("--chart-2");
      const getIncidents = () => incidentsRef.current;
      const pin: CursorPin = { time: null, left: null };
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      // Garis diputus di celah data, bukan ditarik lurus seolah ada sampel (pola addGap uPlot).
      const timeGaps: uPlot.Series.GapsRefiner = (u, _s, idx0, idx1, gaps) => {
        const xs = u.data[0];
        for (let i = idx0 + 1; i <= idx1; i++) {
          if (xs[i] - xs[i - 1] >= TRAFFIC_GAP_SECONDS) {
            UPlot.addGap(
              gaps,
              Math.round(u.valToPos(xs[i - 1], "x", true)),
              Math.round(u.valToPos(xs[i], "x", true)),
            );
          }
        }
        return gaps;
      };

      const initialData: uPlot.AlignedData = history
        ? [history.series.times, history.series.rx, history.series.tx]
        : readLiveData();

      const chart = new UPlot(
        {
          width: container.clientWidth || 600,
          height: container.clientHeight || MIN_HEIGHT,
          padding: [8, 16, 0, 0],
          // Legenda diganti angka di atas grafik dan kotak info di kursor.
          legend: { show: false },
          cursor: { y: false, drag: { x: false, y: false } },
          plugins: [
            incidentBandsPlugin(getIncidents, {
              info: text,
              warning: token("--warning"),
              critical: token("--destructive"),
            }),
            tooltipPlugin(
              rangeSeconds,
              getIncidents,
              pin,
              token("--warning"),
              (p) => onInspectRef.current?.(p),
              !history,
            ),
            ...(history
              ? []
              : [
                  trafficMarksPlugin(
                    { zero: token("--warning"), gap: text, label: text },
                    reduceMotion ? 0 : 400,
                  ),
                ]),
          ],
          scales: {
            x: {
              range: history
                ? () => [
                    historyRef.current?.from ?? history.from,
                    historyRef.current?.to ?? history.to,
                  ]
                : // Jendela tetap 5 menit yang bergerak.
                  (_u, _min, max) =>
                    Number.isFinite(max)
                      ? [max - (TRAFFIC_WINDOW - 1), max]
                      : [0, 1],
            },
            // Sumbu Y mulai dari 0.
            y: {
              range: (_u, _min, max) => [
                0,
                Math.max(10, (Number.isFinite(max) ? max : 0) * 1.15),
              ],
            },
          },
          axes: [
            {
              stroke: text,
              font: FONT,
              grid,
              ticks: grid,
              // Di layar sempit label dirapatkan supaya tetap ada beberapa.
              space: (_u, _axis, _min, _max, plotDim) =>
                plotDim < 420 ? 48 : rangeSeconds > 2 * DAY ? 96 : 84,
              values: (_u, splits) => axisLabels(rangeSeconds, splits),
            },
            { stroke: text, font: FONT, grid, ticks: grid, size: 44 },
          ],
          series: [
            {},
            {
              label: "Unduh",
              stroke: download,
              fill: `${download}22`,
              width: 2,
              ...(history ? {} : { gaps: timeGaps }),
            },
            {
              label: "Unggah",
              stroke: upload,
              fill: `${upload}1f`,
              width: 2,
              ...(history ? {} : { gaps: timeGaps }),
            },
          ],
        },
        initialData,
        container,
      );
      chartRef.current = chart;

      // Gulir halus (live): ujung kanan jendela berjalan terus dari titik lama ke
      // titik baru selama satu detik, bukan meloncat per detik. Mati bila gerak dikurangi.
      let shownRight: number | null = null;
      let fromRight = 0;
      let toRight = 0;
      let scrollStart = 0;
      let scrollFrame = 0;
      const showWindow = (u: uPlot, right: number) => {
        shownRight = right;
        u.batch(() =>
          u.setScale("x", { min: right - (TRAFFIC_WINDOW - 1), max: right }),
        );
        followPin(u, pin);
      };
      const scrollStep = () => {
        scrollFrame = 0;
        const u = chartRef.current;
        if (!u) return;
        const p = Math.min(1, (performance.now() - scrollStart) / SCROLL_MS);
        showWindow(u, fromRight + (toRight - fromRight) * p);
        if (p < 1) scrollFrame = requestAnimationFrame(scrollStep);
      };
      const showLive = (u: uPlot) => {
        const data = readLiveData();
        const times = data[0];
        const latest = times[times.length - 1];
        u.batch(() => {
          u.setData(data);
          // setData memindah jendela ke titik terbaru; kembalikan dulu ke posisi tampil.
          if (shownRight != null && latest != null)
            u.setScale("x", {
              min: shownRight - (TRAFFIC_WINDOW - 1),
              max: shownRight,
            });
        });
        if (latest == null) return;
        const smooth =
          !reduceMotion &&
          shownRight != null &&
          latest > shownRight &&
          latest - shownRight <= 3; // lompatan besar (snapshot ulang): langsung
        if (!smooth) {
          cancelAnimationFrame(scrollFrame);
          scrollFrame = 0;
          showWindow(u, latest);
          return;
        }
        fromRight = shownRight ?? latest;
        toRight = latest;
        scrollStart = performance.now();
        if (!scrollFrame) scrollFrame = requestAnimationFrame(scrollStep);
      };
      if (!history && initialData[0].length > 0) showLive(chart);

      let frame = 0;
      const unsubscribe = useDashboardStore.subscribe((state, previous) => {
        if (!followLive || state.traffic === previous.traffic || frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (!chartRef.current) return;
          const currentHist = historyRef.current;
          if (currentHist) {
            // Mode histori (1h, 6h, dst): saat ada titik live baru tiba,
            // perbarui titik ujung kanan grafik agar grafik terus bergerak per detik
            const live = state.traffic;
            const hTimes = currentHist.series.times;
            if (live.times.length > 0 && hTimes.length > 0) {
              const liveTime = live.times[live.times.length - 1];
              const liveRx = live.rx[live.rx.length - 1];
              const liveTx = live.tx[live.tx.length - 1];
              const lastHistTime = hTimes[hTimes.length - 1];

              if (liveTime > lastHistTime) {
                const step = getRange(rangeId).stepSeconds || 10;
                const times = [...hTimes];
                const rx = [...currentHist.series.rx];
                const tx = [...currentHist.series.tx];

                if (liveTime - lastHistTime >= step) {
                  times.push(liveTime);
                  rx.push(liveRx);
                  tx.push(liveTx);
                  if (times.length > 400) {
                    times.shift();
                    rx.shift();
                    tx.shift();
                  }
                  currentHist.from = times[0];
                  currentHist.to = liveTime;
                } else {
                  times[times.length - 1] = liveTime;
                  rx[rx.length - 1] = liveRx;
                  tx[tx.length - 1] = liveTx;
                  currentHist.to = liveTime;
                }
                currentHist.series = { times, rx, tx };
                chartRef.current.setData([times, rx, tx]);
              }
            }
          } else {
            showLive(chartRef.current);
          }
        });
      });

      let { clientWidth: width, clientHeight: height } = container;
      const observer = new ResizeObserver(() => {
        if (
          container.clientWidth === width &&
          container.clientHeight === height
        ) {
          return;
        }
        width = container.clientWidth;
        height = container.clientHeight;
        chart.setSize({ width, height });
      });
      observer.observe(container);

      cleanup = () => {
        observer.disconnect();
        unsubscribe();
        cancelAnimationFrame(frame);
        cancelAnimationFrame(scrollFrame);
        chartRef.current = null;
        chart.destroy();
      };
    });

    return () => {
      disposed = true;
      cleanup();
    };
    // Grafik hanya dibuat ulang saat rangeId atau tema berganti; pembaruan history ditangani secara terpisah oleh useEffect setData tanpa merusak canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, rangeId]);

  // Grafik diletakkan absolut di dalam kotak yang tingginya ikut kartu, supaya
  // ukuran grafik tidak memengaruhi ukuran kotaknya (tidak ada umpan balik).
  return (
    <div
      role="img"
      aria-label={`Grafik traffic unduh dan unggah, ${label ?? getRange(rangeId).label} terakhir`}
      className="relative min-h-64 w-full flex-1"
    >
      <div ref={containerRef} className="traffic-chart absolute inset-0" />
    </div>
  );
}
