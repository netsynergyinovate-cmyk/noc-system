// Pratinjau pesan WhatsApp (murni): format teks ala WhatsApp dan skenario contoh.

export type WaSegment = { type: "text" | "bold" | "italic" | "strike"; text: string };

// ponytail: tanpa format bersarang (*_a_*); tambahkan bila operator membutuhkannya.
const FORMAT = /(?<!\w)([*_~])(?=\S)([^\n]*?\S)\1(?!\w)/g;
const KIND: Record<string, WaSegment["type"]> = { "*": "bold", _: "italic", "~": "strike" };

export function parseWhatsappFormat(text: string): WaSegment[] {
  const out: WaSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(FORMAT)) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    out.push({ type: KIND[m[1]], text: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

export interface PreviewScenario {
  id: string;
  label: string;
  alert: {
    severity: string;
    kind: string;
    subject: string;
    router: string;
    time: string;
    message: string;
  };
}

const time = "11 Okt 2026 10:00:00";

export const previewScenarios: readonly PreviewScenario[] = [
  {
    id: "router-down",
    label: "Router Putus (Kritis)",
    alert: { severity: "KRITIS", kind: "Router offline", subject: "Router Pusat", router: "RB-Pusat-01", time, message: "Router tidak merespons REST API" },
  },
  {
    id: "optical",
    label: "Sinyal Optik Drop (Kritis)",
    alert: { severity: "KRITIS", kind: "Sinyal optik drop", subject: "Budi Santoso", router: "RB-Cabang-02", time, message: "Redaman -29,5 dBm (batas -27 dBm)" },
  },
  {
    id: "cpu",
    label: "CPU Router 92% (Peringatan)",
    alert: { severity: "PERINGATAN", kind: "CPU tinggi", subject: "Router Cabang", router: "RB-Cabang-02", time, message: "CPU 92% selama 5 menit" },
  },
  {
    id: "recovered",
    label: "Insiden Pulih (Normal)",
    alert: { severity: "NORMAL", kind: "Insiden pulih", subject: "Router Pusat", router: "RB-Pusat-01", time, message: "Router kembali online setelah 12 menit" },
  },
];

// Variabel {nama} yang dikenal dan dipakai template, tanpa duplikat, urut kemunculan.
export function usedTemplateVariables(template: string, known: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const m of template.matchAll(/\{(\w+)\}/g)) if (known.includes(m[1])) seen.add(m[1]);
  return [...seen];
}
