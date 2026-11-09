// Mencari sesi PPPoE milik sebuah ONU lewat MAC. Cermin PPPActiveByMAC di
// backend/internal/collector/backup.go dan macLookupAllowed di backend/internal/httpapi/ontweb.go:
// modem memakai blok MAC berurutan (ONU ...1D, LAN ...1E, WAN ...1F = caller-id di router),
// jadi sesi cocok bila lima oktet pertama sama dan selisih terakhir 1..3. Tidak menebak:
// lebih dari satu kandidat berarti tidak ditemukan.

/** Hanya model yang sudah terukur aman (14/14 CDTC dan 22/22 HWTC H113 cocok dengan pencarian nama PPPoE). HSGQ pernah salah. */
export function callerIdLookupAllowed(
  model: string | null | undefined,
): boolean {
  const m = (model ?? "").trim().toUpperCase();
  return m.startsWith("CDTC") || m.startsWith("HWTC H113");
}

const MAC_MAX_DELTA = 3;

function macValue(s: string | null | undefined): number | null {
  const hex = (s ?? "").trim().replace(/[:-]/g, "");
  return /^[0-9a-fA-F]{12}$/.test(hex) ? parseInt(hex, 16) : null; // 48 bit muat di Number
}

export function sessionNameForOnu(
  onuMac: string | null | undefined,
  sessions: readonly { name: string; callerId: string; address: string }[],
): string | null {
  const want = macValue(onuMac);
  if (want === null) return null;
  const found = new Set<string>();
  for (const s of sessions) {
    const got = macValue(s.callerId);
    if (got === null || !s.name || !s.address) continue; // Go: sesi tanpa alamat dilewati
    const delta = got - want;
    if (
      Math.floor(got / 256) === Math.floor(want / 256) &&
      delta >= 1 &&
      delta <= MAC_MAX_DELTA
    )
      found.add(s.name);
  }
  return found.size === 1 ? [...found][0] : null;
}
