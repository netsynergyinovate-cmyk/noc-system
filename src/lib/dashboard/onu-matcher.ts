// Pencocokan ONU ke pelanggan. Murni: tanpa DB. Urutan aturan (yang pertama
// punya kandidat menentukan hasil, yang lebih lemah tidak pernah menimpa):
//   1. SN / MAC ONU sama persis dengan SN pelanggan  -> exact_sn
//   2. deskripsi ONU = pppoeUsername pelanggan        -> exact_pppoe
//   3. deskripsi ONU = nama pelanggan                 -> exact_name
// Lebih dari satu pelanggan pada tingkat yang menang -> ambiguous (tidak menebak).

export type OnuCandidate = {
  serialNumber?: string | null;
  macAddress?: string | null;
  description?: string | null;
};
export type CustomerCandidate = {
  id: string;
  name: string;
  pppoeUsername: string;
  serialNumber?: string | null;
};
export type MatchStatus = "exact_sn" | "exact_pppoe" | "exact_name" | "ambiguous" | "unmatched";
export type MatchResult =
  | { status: "exact_sn" | "exact_pppoe" | "exact_name"; customerId: string }
  | { status: "ambiguous"; candidateIds: string[] }
  | { status: "unmatched" };

const text = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
// SN/MAC: abaikan pemisah (aa:bb-cc == AABBCC).
const hw = (v: string | null | undefined) => text(v).replace(/[^0-9a-z]/g, "");

export function matchOnuToCustomer(onu: OnuCandidate, customers: CustomerCandidate[]): MatchResult {
  const ids = [hw(onu.serialNumber), hw(onu.macAddress)].filter(Boolean);
  const desc = text(onu.description);
  const levels = [
    ["exact_sn", (c: CustomerCandidate) => ids.length > 0 && ids.includes(hw(c.serialNumber))],
    ["exact_pppoe", (c: CustomerCandidate) => desc !== "" && text(c.pppoeUsername) === desc],
    ["exact_name", (c: CustomerCandidate) => desc !== "" && text(c.name) === desc],
  ] as const;
  for (const [status, test] of levels) {
    const hits = customers.filter(test);
    if (hits.length === 1) return { status, customerId: hits[0].id };
    if (hits.length > 1) return { status: "ambiguous", candidateIds: hits.map((c) => c.id) };
  }
  return { status: "unmatched" };
}
