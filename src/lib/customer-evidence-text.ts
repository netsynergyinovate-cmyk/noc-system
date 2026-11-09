import {
  evidenceRanges,
  peakWindows,
  OFF_PEAK_ID,
  OFF_PEAK_LABEL,
  type CustomerEvidence,
  type PeakWindowId,
} from "./customer-evidence-types";

export function formatMinuteOfDay(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function getWindowTimeSpan(id: PeakWindowId | string): string {
  const pw = peakWindows.find((w) => w.id === id);
  if (pw) {
    return `${formatMinuteOfDay(pw.startMin)}–${formatMinuteOfDay(pw.endMin)}`;
  }
  if (id === OFF_PEAK_ID) {
    return "23:00–11:00";
  }
  return "";
}

export function getWindowLabelWithSpan(stat: {
  id: PeakWindowId | string;
  label: string;
}): string {
  const span = getWindowTimeSpan(stat.id);
  return span ? `${stat.label} (${span})` : stat.label;
}

export function formatWibDateTime(epochSec: number | null | undefined): string {
  if (
    epochSec === null ||
    epochSec === undefined ||
    Number.isNaN(epochSec) ||
    epochSec <= 0
  ) {
    return "–";
  }
  const d = new Date(epochSec * 1000);
  const formatted = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return formatted.replace(/\u202f|\u00a0/g, " ") + " WIB";
}

export function formatDurationCompact(seconds: number): string {
  const totalSec = Math.max(0, Math.floor(seconds || 0));
  const totalMin = Math.round(totalSec / 60);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours === 0) return `${mins} m`;
  return `${hours} j ${mins} m`;
}

export function formatEvidenceSummary(
  evidence: CustomerEvidence,
  meta?: { name?: string; pppoeUsername?: string },
): string {
  const rangeObj = evidenceRanges.find((r) => r.id === evidence.range);
  const rangeLabel = rangeObj ? rangeObj.label : evidence.range;
  const lines: string[] = [];

  lines.push(`=== BUKTI KELUHAN PELANGGAN (${rangeLabel.toUpperCase()}) ===`);
  if (meta?.name || meta?.pppoeUsername) {
    const parts = [
      meta.name,
      meta.pppoeUsername ? `(${meta.pppoeUsername})` : null,
    ].filter(Boolean);
    lines.push(`Pelanggan: ${parts.join(" ")}`);
  }
  lines.push(
    `Periode bukti: ${formatWibDateTime(evidence.from)} s.d. ${formatWibDateTime(evidence.to)}`,
  );

  // Status & ringkasan
  const stateLabel =
    evidence.connection.state === "up"
      ? "Online"
      : evidence.connection.state === "down"
        ? "Offline"
        : "Belum diketahui";
  const sinceStr = formatWibDateTime(evidence.connection.since);
  lines.push(`Status saat ini: ${stateLabel} (sejak ${sinceStr})`);

  const summary = evidence.incidentSummary ?? {
    real: 0,
    belumTerverifikasi: 0,
    tidakTerbukti: 0,
    kedipan: 0,
    realDownSeconds: 0,
    realByWindow: {
      siang: 0,
      "pulang-sekolah": 0,
      "pulang-kerja": 0,
      "magrib-malam": 0,
      luar: 0,
    },
    realMassal: 0,
    lastRealAt: null,
  };
  const connSummary = evidence.connection.summary;

  lines.push("");
  lines.push("Ringkasan Gangguan:");
  lines.push(`- Gangguan nyata: ${summary.real} kali`);
  lines.push(
    `- Total durasi down nyata: ${formatDurationCompact(summary.realDownSeconds)}`,
  );
  lines.push(
    `- Status verifikasi lain: ${summary.belumTerverifikasi} belum terverifikasi, ${summary.tidakTerbukti} tidak terbukti, ${summary.kedipan} kedipan`,
  );
  lines.push(`- Kejadian putus tercatat: ${connSummary.outageCount} kali`);
  lines.push(
    `- Uptime: ${connSummary.uptimePct !== null ? `${connSummary.uptimePct.toFixed(1)}%` : "–"}`,
  );

  // Daftar gangguan nyata
  lines.push("");
  lines.push("Daftar Gangguan Nyata:");
  const realIncidents = (evidence.incidents ?? []).filter(
    (inc) => inc.verdict === "terbukti",
  );
  if (realIncidents.length === 0) {
    lines.push("- Tidak ada gangguan nyata tercatat pada rentang ini.");
  } else {
    for (const inc of realIncidents) {
      const fromStr = formatWibDateTime(inc.from);
      const toStr = inc.to ? formatWibDateTime(inc.to) : "masih down";
      const dur = formatDurationCompact(inc.downSeconds);
      const winLabels = inc.windows.map((wId) => {
        const pw = peakWindows.find((p) => p.id === wId);
        return pw ? pw.label : wId === OFF_PEAK_ID ? OFF_PEAK_LABEL : wId;
      });
      const winStr =
        winLabels.length > 0 ? ` [Jam sibuk: ${winLabels.join(", ")}]` : "";
      const scopeStr =
        inc.scope.kind === "massal"
          ? ` [Cakupan: Massal (${inc.scope.otherDown} pelanggan lain)]`
          : inc.scope.kind === "sendiri"
            ? " [Cakupan: Sendiri]"
            : " [Cakupan: Tidak diketahui]";
      const beforeStr =
        inc.beforeAvgDownMbps !== null
          ? `${inc.beforeAvgDownMbps.toFixed(1)} Mbps`
          : "–";
      const afterStr =
        inc.afterAvgDownMbps !== null
          ? `${inc.afterAvgDownMbps.toFixed(1)} Mbps`
          : "–";
      const trafStr = ` [Trafik: ${beforeStr} -> ${afterStr}]`;
      const alertTag =
        inc.sources.includes("alert") && !inc.sources.includes("live")
          ? " (dari alert)"
          : "";
      lines.push(
        `- Mulai: ${fromStr} | Selesai: ${toStr} (${dur})${winStr}${scopeStr}${trafStr}${alertTag}`,
      );
    }
  }
  // Analisis jam sibuk
  lines.push("");
  lines.push("Analisis Jam Sibuk:");
  // Pastikan off-peak diletakkan di akhir
  const sortedWindows = [...evidence.windows].sort((a, b) => {
    if (a.id === OFF_PEAK_ID) return 1;
    if (b.id === OFF_PEAK_ID) return -1;
    return 0;
  });
  for (const win of sortedWindows) {
    const timeSpan = getWindowTimeSpan(win.id);
    const spanText = timeSpan ? ` (${timeSpan})` : "";
    const avgDown =
      win.avgDownMbps !== null ? `${win.avgDownMbps.toFixed(1)} Mbps` : "–";
    const avgUp =
      win.avgUpMbps !== null ? `${win.avgUpMbps.toFixed(1)} Mbps` : "–";
    const p95Down =
      win.p95DownMbps !== null ? `${win.p95DownMbps.toFixed(1)} Mbps` : "–";
    const maxDown =
      win.maxDownMbps !== null ? `${win.maxDownMbps.toFixed(1)} Mbps` : "–";
    const downTime = formatDurationCompact(win.downSeconds);
    lines.push(
      `- ${win.label}${spanText}: Rata-rata ${avgDown} unduh / ${avgUp} unggah | P95 unduh: ${p95Down} | Puncak unduh: ${maxDown} | Down: ${downTime} | Mulai gangguan: ${win.outageStarts}x`,
    );
  }

  // Temuan deteksi
  if (evidence.findings.length > 0) {
    lines.push("");
    lines.push("Temuan Deteksi:");
    for (const f of evidence.findings) {
      lines.push(`- [${f.severity.toUpperCase()}] ${f.text}`);
    }
  }

  // Catatan cakupan data
  if (evidence.coverage.notes.length > 0) {
    lines.push("");
    lines.push("Catatan Cakupan Data:");
    for (const note of evidence.coverage.notes) {
      lines.push(`- ${note}`);
    }
  }

  return lines.join("\n");
}
