// Nama ONU di OLT biasanya "KODE-NAMA PELANGGAN" ("1103-ALDI FAREZI"). Nama yang
// pantas ditampilkan sebagai nama pelanggan adalah bagian sesudah kode. Nama bawaan
// OLT ("ONU01/23") dan nama kosong tidak mengandung nama orang: dikembalikan null.

const GENERIC = [
  /^onu\s*\d+\s*\/\s*\d+$/i, // ONU01/23
  /^pppoe\b/i, // "PPPoE Cust 17060001861", juga yang terpotong: "PPPoE C"
  /^no-?desc/i,
  /^-+$/,
];

export function displayNameFromOnu(
  raw: string | null | undefined,
): string | null {
  let name = (raw ?? "").trim();
  if (!name) return null;
  name = name
    .replace(/^\d{3,6}\s*-\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 2 || name.length > 100) return null;
  if (GENERIC.some((re) => re.test(name))) return null;
  // Harus memuat huruf: kode saja atau nomor bukan nama.
  if (!/\p{L}/u.test(name)) return null;
  return name;
}
