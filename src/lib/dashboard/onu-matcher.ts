// Pencocokan ONU ke pelanggan. Murni: tanpa DB. Urutan aturan (yang pertama
// punya kandidat menentukan hasil, yang lebih lemah tidak pernah menimpa):
//   1. SN / MAC ONU sama persis dengan SN pelanggan  -> exact_sn
//   2. deskripsi ONU = pppoeUsername pelanggan        -> exact_pppoe
//   3. deskripsi ONU = nama pelanggan                 -> exact_name
//   4. nama ONU memuat nomor PPPoE pelanggan utuh     -> name_pppoe
//      (mis. "1861-PPPoE Cust 17060001861" untuk 17060001861@runsnet.id)
//   5. kode di awal nama ONU ("1103-ALDI FAREZI", atau kode saja "1103") = ekor nomor PPPoE pelanggan
//      -> code_suffix. Hanya bila kode itu tidak dipakai ONU lain (nama ONU yang
//      kembar berarti kodenya tidak bisa dipakai membedakan), dan hanya untuk
//      nomor PPPoE yang seluruhnya angka.
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
export type MatchStatus =
  | "exact_sn"
  | "exact_pppoe"
  | "exact_name"
  | "name_pppoe"
  | "code_suffix"
  | "ambiguous"
  | "unmatched";
export type MatchResult =
  | {
      status: "exact_sn" | "exact_pppoe" | "exact_name" | "name_pppoe" | "code_suffix";
      customerId: string;
    }
  | { status: "ambiguous"; candidateIds: string[] }
  | { status: "unmatched" };

const text = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
// SN/MAC: abaikan pemisah (aa:bb-cc == AABBCC).
const hw = (v: string | null | undefined) => text(v).replace(/[^0-9a-z]/g, "");

// Nomor PPPoE tanpa "@domain".
const pppoeLocal = (u: string) => text(u).split("@")[0];
const MIN_PPPOE_DIGITS = 8; // nomor pendek terlalu mudah kebetulan ada di nama
const CODE_RE = /^(\d{3,6})\s*(?:-|$)/;

/** Kode di awal nama ONU ("1103-ALDI" atau "1103" -> "1103"), atau null. */
export function onuNameCode(name: string | null | undefined): string | null {
  const m = CODE_RE.exec((name ?? "").trim());
  return m ? m[1] : null;
}

export type MatchContext = {
  /** Kode nama ONU yang dipakai lebih dari satu ONU: tidak dipakai mencocokkan. */
  duplicateCodes?: ReadonlySet<string>;
};

export function matchOnuToCustomer(
  onu: OnuCandidate,
  customers: CustomerCandidate[],
  ctx: MatchContext = {},
): MatchResult {
  const ids = [hw(onu.serialNumber), hw(onu.macAddress)].filter(Boolean);
  const desc = text(onu.description);
  const levels = [
    ["exact_sn", (c: CustomerCandidate) => ids.length > 0 && ids.includes(hw(c.serialNumber))],
    ["exact_pppoe", (c: CustomerCandidate) => desc !== "" && text(c.pppoeUsername) === desc],
    ["exact_name", (c: CustomerCandidate) => desc !== "" && text(c.name) === desc],
    [
      "name_pppoe",
      (c: CustomerCandidate) => {
        const id = pppoeLocal(c.pppoeUsername);
        return /^\d+$/.test(id) && id.length >= MIN_PPPOE_DIGITS && desc.includes(id);
      },
    ],
    [
      "code_suffix",
      (c: CustomerCandidate) => {
        const code = onuNameCode(desc);
        const id = pppoeLocal(c.pppoeUsername);
        return (
          code !== null &&
          !ctx.duplicateCodes?.has(code) &&
          /^\d+$/.test(id) &&
          id.length >= MIN_PPPOE_DIGITS &&
          id.endsWith(code)
        );
      },
    ],
  ] as const;
  for (const [status, test] of levels) {
    const hits = customers.filter(test);
    if (hits.length === 1) return { status, customerId: hits[0].id };
    if (hits.length > 1) return { status: "ambiguous", candidateIds: hits.map((c) => c.id) };
  }
  return { status: "unmatched" };
}
