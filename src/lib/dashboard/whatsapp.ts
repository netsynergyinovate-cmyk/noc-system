// Pengaturan alert WhatsApp (mock). Murni: tanpa React, tanpa penyimpanan.
// Gateway sungguhan dan pengiriman pesan dikerjakan backend; nilai di sini
// belum dibaca siapa pun selain halaman Pengaturan.

import { recordWhatsappLog } from "./whatsapp-log.ts";

export type WaProvider = "fonnte" | "wablas" | "custom";

export interface WhatsappRecipient {
  id: string;
  name: string;
  phone: string; // normalisasi 628xxx atau ID grup
  type: "personal" | "group";
  active: boolean;
}

export interface WhatsappConfig {
  enabled: boolean;
  provider: WaProvider;
  gatewayUrl: string;
  apiKey: string;
  recipients: WhatsappRecipient[];
  minSeverity: "critical" | "warning";
  template: string;
}

export const defaultWhatsappConfig: WhatsappConfig = Object.freeze({
  enabled: false,
  provider: "fonnte",
  gatewayUrl: "https://api.fonnte.com/send",
  apiKey: "",
  recipients: Object.freeze([
    Object.freeze({ id: "rcp-1", name: "Piket NOC Utama", phone: "6281234567890", type: "personal", active: true }),
    Object.freeze({ id: "rcp-2", name: "Grup Eskalasi Insiden", phone: "6289876543210", type: "group", active: true }),
  ]) as unknown as WhatsappRecipient[],
  minSeverity: "critical",
  template:
    "🚨 *NOC ALERT [{severity}]*\nJenis: {kind}\nPerangkat: {subject}\nRouter: {router}\nWaktu: {time}\nKondisi: {message}",
});

export const providerDefaultUrl: Record<WaProvider, string> = {
  fonnte: "https://api.fonnte.com/send",
  wablas: "https://console.wablas.com/api/send-message",
  custom: "",
};

export const templateVariables = [
  "severity",
  "kind",
  "subject",
  "router",
  "time",
  "message",
] as const;

// 0812..., +62812..., 62812..., 0812-3456 7890 -> 62812...; selain itu "".
export function normalizePhone(phone: string): string {
  const trimmed = String(phone ?? "").trim();
  const digits = trimmed.replace(/[\s().-]/g, "");
  if (!/^\+?\d+$/.test(digits)) return "";
  const d = digits.startsWith("+") ? digits.slice(1) : digits;
  let out: string;
  if (d.startsWith("62")) out = d;
  else if (d.startsWith("08")) out = `62${d.slice(1)}`;
  else return "";
  // 62 + 8xx + 7 sampai 11 digit
  return /^628\d{7,11}$/.test(out) ? out : "";
}

// ID grup: angka (opsional -angka), akhiran @g.us opsional.
const GROUP_ID = /^\d{10,25}(-\d{5,})?(@g\.us)?$/;

// Bentuk baku, atau "" bila tidak valid untuk tipenya.
export function normalizeRecipientPhone(phone: string, type: WhatsappRecipient["type"]): string {
  if (type === "personal") return normalizePhone(phone);
  const g = String(phone ?? "").trim();
  return GROUP_ID.test(g) ? g : "";
}

export type RecipientResult =
  | { ok: true; list: WhatsappRecipient[]; recipient: WhatsappRecipient }
  | { ok: false; error: string };

export function addRecipient(
  list: readonly WhatsappRecipient[],
  input: { name: string; phone: string; type: WhatsappRecipient["type"] },
): RecipientResult {
  const name = String(input.name ?? "").trim();
  if (!name) return { ok: false, error: "Nama penerima wajib diisi." };
  const phone = normalizeRecipientPhone(input.phone, input.type);
  if (!phone)
    return {
      ok: false,
      error:
        input.type === "group"
          ? "ID grup tidak valid. Contoh: 120363012345678901@g.us"
          : "Nomor tidak valid. Contoh: 081234567890 atau +6281234567890.",
    };
  if (list.some((r) => r.phone === phone)) return { ok: false, error: "Nomor sudah ada di daftar." };
  const used = new Set(list.map((r) => r.id));
  let n = list.length + 1;
  while (used.has(`rcp-${n}`)) n++;
  const recipient: WhatsappRecipient = { id: `rcp-${n}`, name, phone, type: input.type, active: true };
  return { ok: true, list: [...list, recipient], recipient };
}

export function toggleRecipient(list: readonly WhatsappRecipient[], id: string): WhatsappRecipient[] {
  return list.map((r) => (r.id === id ? { ...r, active: !r.active } : r));
}

export function removeRecipient(list: readonly WhatsappRecipient[], id: string): WhatsappRecipient[] {
  return list.filter((r) => r.id !== id);
}

export function getActiveRecipientPhones(list: readonly WhatsappRecipient[]): string[] {
  return list.filter((r) => r.active).map((r) => r.phone);
}

export function validateWhatsappConfig(cfg: Partial<WhatsappConfig>): {
  valid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};

  const url = (cfg.gatewayUrl ?? "").trim();
  if (!url) errors.gatewayUrl = "Gateway URL wajib diisi.";
  else {
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:")
        errors.gatewayUrl = "Gateway URL harus diawali http:// atau https://.";
    } catch {
      errors.gatewayUrl = "Gateway URL tidak valid.";
    }
  }

  if (cfg.enabled && !(cfg.apiKey ?? "").trim())
    errors.apiKey = "API token wajib diisi saat notifikasi diaktifkan.";

  const recipients = cfg.recipients ?? [];
  if (cfg.enabled && !recipients.some((r) => r.active))
    errors.recipients = "Aktifkan minimal satu penerima.";
  else if (
    recipients.some((r) => !r.name.trim() || normalizeRecipientPhone(r.phone, r.type) !== r.phone)
  )
    errors.recipients = "Setiap penerima harus punya nama dan nomor/ID grup yang valid.";

  if (!(cfg.template ?? "").trim()) errors.template = "Template pesan wajib diisi.";

  return { valid: Object.keys(errors).length === 0, errors };
}

export interface MockWhatsappAlert {
  severity: "critical" | "warning";
  kind: string;
  subject: string;
  router: string;
  time: string;
  message: string;
  id?: string;
}

export interface SendMockOptions {
  /** Latensi simulasi gateway; bawaan 400 ms. */
  delayMs?: number;
  /** Pencatat log; bawaan recordWhatsappLog (localStorage). */
  record?: typeof recordWhatsappLog;
}

export type SendMockResult =
  | { ok: true; sentCount: number; phones: string[]; latencyMs: number }
  | { ok: false; error: string };

// Simulasi pengiriman: tidak ada permintaan jaringan. Mencatat satu log per nomor aktif.
export async function sendMockWhatsappAlert(
  config: Pick<WhatsappConfig, "gatewayUrl" | "apiKey" | "recipients" | "template">,
  alert: MockWhatsappAlert,
  options: SendMockOptions = {},
): Promise<SendMockResult> {
  const { delayMs = 400, record = recordWhatsappLog } = options;

  const url = (config.gatewayUrl ?? "").trim();
  let urlOk = false;
  try {
    const u = new URL(url);
    urlOk = u.protocol === "http:" || u.protocol === "https:";
  } catch {
    urlOk = false;
  }
  if (!urlOk) return { ok: false, error: "Gateway URL tidak valid." };
  if (!(config.apiKey ?? "").trim()) return { ok: false, error: "API token wajib diisi." };
  const targets = config.recipients.filter((r) => r.active);
  if (targets.length === 0) return { ok: false, error: "Tidak ada nomor penerima aktif." };

  const started = Date.now();
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  const latencyMs = Math.max(delayMs, Date.now() - started);

  const message = renderWhatsappMessage(config.template, alert);
  for (const r of targets) {
    record({
      recipientName: r.name,
      recipientPhone: r.phone,
      alertId: alert.id ?? "alert-uji",
      severity: alert.severity,
      kind: alert.kind,
      message,
      status: "delivered",
      latencyMs,
    });
  }
  return { ok: true, sentCount: targets.length, phones: targets.map((r) => r.phone), latencyMs };
}

export type AlertSeverity = "critical" | "warning" | "info";

const severityLabels: Record<AlertSeverity, string> = {
  critical: "\u{1F6A8} KRITIS",
  warning: "\u26A0\uFE0F PERINGATAN",
  info: "\u2139\uFE0F INFO",
};

// Kode keparahan -> label ber-emoji; teks lain (mis. "KRITIS") dibiarkan.
export function severityLabel(severity: string): string {
  return Object.prototype.hasOwnProperty.call(severityLabels, severity)
    ? severityLabels[severity as AlertSeverity]
    : severity;
}

// critical: hanya kritis. warning: kritis + peringatan. info tidak pernah dikirim.
export function shouldSendAlert(
  alertSeverity: AlertSeverity,
  minSeverity: "critical" | "warning",
): boolean {
  if (alertSeverity === "critical") return true;
  return alertSeverity === "warning" && minSeverity === "warning";
}

export function renderWhatsappMessage(
  template: string,
  alert: {
    severity: string;
    kind: string;
    subject: string;
    router: string;
    time: string;
    message: string;
  },
): string {
  const values = { ...alert, severity: severityLabel(alert.severity) };
  // Satu lintasan: nilai yang berisi "{kind}" tidak diganti lagi.
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key as keyof typeof values])
      : match,
  );
}