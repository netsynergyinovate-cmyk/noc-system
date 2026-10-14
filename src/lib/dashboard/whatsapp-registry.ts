import {
  defaultWhatsappConfig,
  normalizeRecipientPhone,
  type WaProvider,
  type WhatsappConfig,
  type WhatsappRecipient,
} from "./whatsapp.ts";

// Pengaturan WhatsApp tersimpan: localStorage key `whatsappConfig`, memori saja
// bila penyimpanan diblokir atau penuh. Tidak ada rahasia sungguhan di sini:
// ini data tiruan sampai backend menyimpan token di sisi server.

export const WHATSAPP_STORAGE_KEY = "whatsappConfig";

export type WhatsappStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const providers: WaProvider[] = ["fonnte", "wablas", "custom"];

function cloneDefault(): WhatsappConfig {
  return {
    ...defaultWhatsappConfig,
    recipients: defaultWhatsappConfig.recipients.map((r) => ({ ...r })),
  };
}

function parse(raw: string | null): WhatsappConfig {
  const base = cloneDefault();
  if (raw === null) return base;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return base;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return base;
  const o = v as Record<string, unknown>;
  if (typeof o.enabled === "boolean") base.enabled = o.enabled;
  if (providers.includes(o.provider as WaProvider)) base.provider = o.provider as WaProvider;
  if (typeof o.gatewayUrl === "string") base.gatewayUrl = o.gatewayUrl;
  if (typeof o.apiKey === "string") base.apiKey = o.apiKey;
  if (Array.isArray(o.recipients)) {
    const out: WhatsappRecipient[] = [];
    for (const r of o.recipients) {
      // Format lama: string nomor saja.
      const x: Record<string, unknown> =
        typeof r === "string"
          ? { name: r, phone: r, type: "personal", active: true }
          : typeof r === "object" && r !== null
            ? (r as Record<string, unknown>)
            : {};
      const type = x.type === "group" ? "group" : "personal";
      const phone = typeof x.phone === "string" ? normalizeRecipientPhone(x.phone, type) : "";
      const name = typeof x.name === "string" ? x.name.trim() : "";
      if (!phone || !name || out.some((e) => e.phone === phone)) continue;
      let id = typeof x.id === "string" && x.id ? x.id : `rcp-${out.length + 1}`;
      while (out.some((e) => e.id === id)) id = `${id}-x`;
      out.push({ id, name, phone, type, active: typeof x.active === "boolean" ? x.active : true });
    }
    base.recipients = out;
  }
  if (o.minSeverity === "critical" || o.minSeverity === "warning")
    base.minSeverity = o.minSeverity;
  if (typeof o.template === "string" && o.template.trim()) base.template = o.template;
  return base;
}

function same(a: WhatsappConfig, b: WhatsappConfig) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createWhatsappRegistry(
  storage: () => WhatsappStorage | null = () => {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      return null;
    }
  },
) {
  let current: WhatsappConfig = cloneDefault();
  let lastRaw: string | null | undefined;
  let memoryOnly = false;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const l of [...listeners]) l();
  };

  function get(): WhatsappConfig {
    if (memoryOnly) return current;
    try {
      const store = storage();
      if (store === null) throw new Error("no storage");
      const raw = store.getItem(WHATSAPP_STORAGE_KEY);
      if (raw !== lastRaw) {
        lastRaw = raw;
        const next = parse(raw);
        if (!same(next, current)) current = next;
      }
    } catch {
      memoryOnly = true;
    }
    return current;
  }

  function commit(next: WhatsappConfig, raw: string | null) {
    if (!same(next, current)) current = next;
    if (!memoryOnly) {
      try {
        const store = storage();
        if (store === null) throw new Error("no storage");
        if (raw === null) store.removeItem(WHATSAPP_STORAGE_KEY);
        else store.setItem(WHATSAPP_STORAGE_KEY, raw);
        lastRaw = raw;
      } catch {
        memoryOnly = true;
      }
    }
    emit();
  }

  function save(cfg: WhatsappConfig) {
    const next = { ...cfg, recipients: cfg.recipients.map((r) => ({ ...r })) };
    commit(next, JSON.stringify(next));
  }

  function reset() {
    commit(cloneDefault(), null);
  }

  function subscribe(cb: () => void) {
    listeners.add(cb);
    let stop = () => {};
    if (typeof window !== "undefined") {
      const h = (e: StorageEvent) => {
        if (e.key === null || e.key === WHATSAPP_STORAGE_KEY) cb();
      };
      window.addEventListener("storage", h);
      stop = () => window.removeEventListener("storage", h);
    }
    return () => {
      listeners.delete(cb);
      stop();
    };
  }

  const serverSnapshot = cloneDefault();
  return { get, save, reset, subscribe, getServerSnapshot: () => serverSnapshot };
}

const registry = createWhatsappRegistry();

export const getWhatsappConfig = registry.get;
export const saveWhatsappConfig = registry.save;
export const loadWhatsappConfig = registry.get;
export const resetWhatsappConfig = registry.reset;
export const subscribeWhatsappConfig = registry.subscribe;
export const getWhatsappServerSnapshot = registry.getServerSnapshot;
