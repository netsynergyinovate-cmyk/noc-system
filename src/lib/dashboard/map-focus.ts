// Tautan dalam yang membuka dashboard dengan peta menyorot satu pelanggan:
// /app?focus=<id pelanggan>. Pembuat tautan (daftar alert) dan pembacanya
// (halaman dashboard) memakai batas yang sama dari sini, supaya tautan yang
// dibuat selalu bisa dibaca.

export const MAX_FOCUS_ID_LENGTH = 100;

// Nilai ?focus= yang dipakai, atau null bila kosong, berulang (daftar), atau
// kepanjangan.
export function readFocusId(value: string | string[] | undefined) {
  const id = typeof value === "string" ? value.trim() : "";
  return id && id.length <= MAX_FOCUS_ID_LENGTH ? id : null;
}

// Tautan untuk satu pelanggan, atau null bila id-nya tidak akan terbaca
// (kosong atau terlalu panjang), jadi pemanggil tidak menampilkan tautan mati.
export function mapFocusHref(customerId: string) {
  return readFocusId(customerId) === customerId
    ? `/app?focus=${encodeURIComponent(customerId)}`
    : null;
}
