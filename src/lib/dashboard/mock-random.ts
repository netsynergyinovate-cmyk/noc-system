// Bilangan pseudo-acak deterministik untuk data tiruan: hasilnya hanya
// bergantung pada masukan, jadi data yang sama muncul di server, di browser,
// dan setiap kali halaman dibuka.

// Bilangan acak dalam [0, 1) dari sebuah bilangan bulat.
export function unit(n: number) {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// Bilangan bulat tetap dari sebuah teks (FNV-1a), untuk memilih sesuatu
// berdasarkan id.
export function hashString(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
