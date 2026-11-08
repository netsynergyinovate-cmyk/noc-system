// Logika murni pemetaan ONU -> pelanggan PPPoE (Fase 2, data tiruan).
// ponytail: penyimpanan di localStorage/memori; ganti dengan tabel DB + API di Fase 5.

export interface OnuMappingCandidate {
  onuId: string;
  serialNumber: string;
  macAddress?: string;
  oltId?: string;
  oltName: string;
  ponPort: string;
  ponIndex?: number | null;
  onuIndex?: number | null;
  rxPowerDbm: number | null;
  currentCustomerId: string | null;
  currentCustomerName?: string | null;
}

export interface CustomerMappingCandidate {
  id: string;
  name: string;
  pppoeUsername: string;
  address: string;
  assignedOnuId?: string | null;
}

export interface OnuMappingAssignment {
  onuId: string;
  customerId: string | null;
  mappedAt: string;
  mappedBy: string;
}

export interface MappingSuggestion {
  onuId: string;
  customerId: string;
  reason: string;
  confidence: "high" | "medium";
}

export const ONU_MAPPING_STORAGE_KEY = "onu_customer_mappings";

// ---------- Penyimpanan ----------

let memoryStore: Record<string, OnuMappingAssignment> = {};

function getStorage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

function readAll(): Record<string, OnuMappingAssignment> {
  const storage = getStorage();
  if (!storage) return { ...memoryStore };
  try {
    const raw = storage.getItem(ONU_MAPPING_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, OnuMappingAssignment> = {};
    for (const [onuId, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (onuId === "__proto__" || typeof v !== "object" || v === null) continue;
      const a = v as Partial<OnuMappingAssignment>;
      if (a.customerId !== null && typeof a.customerId !== "string") continue;
      out[onuId] = {
        onuId,
        customerId: a.customerId ?? null,
        mappedAt: typeof a.mappedAt === "string" ? a.mappedAt : "",
        mappedBy: typeof a.mappedBy === "string" ? a.mappedBy : "",
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, OnuMappingAssignment>): void {
  memoryStore = { ...data };
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(ONU_MAPPING_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage penuh/diblokir: memori tetap menyimpan
  }
}

export function validateMappingPair(
  onuId: string,
  customerId: string | null,
): { valid: boolean; error?: string } {
  if (typeof onuId !== "string" || onuId.trim() === "") {
    return { valid: false, error: "ID ONU wajib diisi." };
  }
  if (customerId !== null && (typeof customerId !== "string" || customerId.trim() === "")) {
    return { valid: false, error: "ID pelanggan tidak valid." };
  }
  return { valid: true };
}

/** Simpan pemetaan; satu pelanggan hanya satu ONU (ONU lama dilepas). */
export function saveOnuMapping(
  onuId: string,
  customerId: string | null,
  operator: string,
): OnuMappingAssignment {
  const check = validateMappingPair(onuId, customerId);
  if (!check.valid) throw new Error(check.error);
  const now = new Date().toISOString();
  const all = readAll();
  const mappedBy = operator.trim() || "operator";
  if (customerId !== null) {
    for (const [otherId, a] of Object.entries(all)) {
      if (otherId !== onuId && a.customerId === customerId) {
        all[otherId] = { onuId: otherId, customerId: null, mappedAt: now, mappedBy };
      }
    }
  }
  const assignment: OnuMappingAssignment = { onuId, customerId, mappedAt: now, mappedBy };
  all[onuId] = assignment;
  writeAll(all);
  return assignment;
}

export function getOnuMappings(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [onuId, a] of Object.entries(readAll())) out[onuId] = a.customerId;
  return out;
}

export function getMappedCustomerForOnu(onuId: string): string | null {
  return getOnuMappings()[onuId] ?? null;
}

export function clearOnuMappings(): void {
  memoryStore = {};
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(ONU_MAPPING_STORAGE_KEY);
  } catch {
    // diabaikan
  }
}

// ---------- Saran pencocokan otomatis ----------

function alnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Bagian username sebelum "@", tanpa karakter non-alfanumerik. */
function usernameCore(username: string): string {
  return alnum(username.split("@")[0] ?? "");
}

function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

function namesSimilar(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = new Set(nameTokens(b));
  if (ta.length === 0 || tb.size === 0) return false;
  const shared = ta.filter((t) => tb.has(t)).length;
  return shared >= Math.min(2, Math.min(ta.length, tb.size));
}

const MIN_CORE = 4;

function scorePair(
  onu: OnuMappingCandidate,
  cust: CustomerMappingCandidate,
): { confidence: "high" | "medium"; reason: string } | null {
  const serial = alnum(onu.serialNumber);
  const mac = alnum(onu.macAddress ?? "");
  const core = usernameCore(cust.pppoeUsername);
  const full = alnum(cust.pppoeUsername);
  if (core.length >= MIN_CORE && (serial.includes(core) || mac.includes(core))) {
    return { confidence: "high", reason: `Username PPPoE "${cust.pppoeUsername}" cocok dengan serial/MAC ONU.` };
  }
  if (full.length >= MIN_CORE && serial.length >= MIN_CORE && (full.includes(serial) || serial === core)) {
    return { confidence: "high", reason: `Serial ONU ${onu.serialNumber} tercantum pada username PPPoE.` };
  }
  if (onu.currentCustomerName && namesSimilar(onu.currentCustomerName, cust.name)) {
    return { confidence: "medium", reason: `Nama "${onu.currentCustomerName}" mirip "${cust.name}".` };
  }
  const port = onu.ponPort.toLowerCase().replace(/\s+/g, " ").trim();
  if (port.length >= 4 && cust.address.toLowerCase().includes(port)) {
    return { confidence: "medium", reason: `Port ${onu.ponPort} tercantum pada alamat pelanggan.` };
  }
  return null;
}

/**
 * Saran pasangan ONU-pelanggan. Hanya ONU yang belum terpetakan dan pelanggan
 * yang belum punya ONU; tiap ONU/pelanggan muncul paling banyak sekali,
 * kecocokan "high" didahulukan.
 */
export function suggestAutoMapping(
  onus: OnuMappingCandidate[],
  customers: CustomerMappingCandidate[],
): MappingSuggestion[] {
  const freeOnus = onus.filter((o) => !o.currentCustomerId);
  const freeCustomers = customers.filter((c) => !c.assignedOnuId);
  const pairs: Array<MappingSuggestion & { order: number }> = [];
  let order = 0;
  for (const onu of freeOnus) {
    for (const cust of freeCustomers) {
      const s = scorePair(onu, cust);
      if (s) pairs.push({ onuId: onu.onuId, customerId: cust.id, reason: s.reason, confidence: s.confidence, order: order++ });
    }
  }
  pairs.sort((a, b) => (a.confidence === b.confidence ? a.order - b.order : a.confidence === "high" ? -1 : 1));
  const usedOnu = new Set<string>();
  const usedCust = new Set<string>();
  const result: MappingSuggestion[] = [];
  for (const p of pairs) {
    if (usedOnu.has(p.onuId) || usedCust.has(p.customerId)) continue;
    usedOnu.add(p.onuId);
    usedCust.add(p.customerId);
    result.push({ onuId: p.onuId, customerId: p.customerId, reason: p.reason, confidence: p.confidence });
  }
  return result;
}
