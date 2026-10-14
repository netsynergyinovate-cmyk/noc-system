import "server-only";
import { env } from "@/lib/env";
import { getMockPonPortDetail, parsePonId, type PonPortDetail } from "@/lib/dashboard/pon-ports";
import { getOltPonPort } from "@/services/devices.service";

// Dipisah dari pon-ports.ts: file itu dipakai komponen klien, sedangkan ini menyentuh DB.
// ponIndex 0 tidak sah (indeks PON mulai dari 1).
export async function resolvePonPortDetail(id: string): Promise<PonPortDetail | null> {
  const parsed = parsePonId(id);
  if (!parsed) return null;
  if (parsed.kind === "mock") return env.DASHBOARD_DATA === "live" ? null : getMockPonPortDetail(id);
  if (parsed.ponIndex < 1) return null;
  return getOltPonPort(parsed.oltId, parsed.ponIndex);
}
