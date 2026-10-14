// Membagi daftar panjang menjadi halaman. Murni, supaya mudah diuji tanpa
// layar: komponen hanya menyimpan nomor halaman yang diminta.

export interface Page<T> {
  // Halaman yang dipakai (mulai dari 1), sudah dipaksa masuk rentang.
  page: number;
  pageCount: number;
  items: T[];
  // Nomor urut baris pertama dan terakhir di halaman ini (mulai dari 1); nol
  // keduanya bila daftarnya kosong.
  from: number;
  to: number;
  total: number;
}

export function pageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize));
}

// Daftar bisa menyusut sejak halaman dipilih (alert lama keluar dari jendela),
// jadi nomor yang diminta tidak dipercaya begitu saja. Nomor yang bukan bilangan
// bulat positif jatuh ke halaman pertama.
export function paginate<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize: number,
): Page<T> {
  const count = pageCount(items.length, pageSize);
  const wanted = Number.isInteger(requestedPage) ? requestedPage : 1;
  const page = Math.min(Math.max(1, wanted), count);
  const start = (page - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return {
    page,
    pageCount: count,
    items: slice,
    from: slice.length === 0 ? 0 : start + 1,
    to: start + slice.length,
    total: items.length,
  };
}
