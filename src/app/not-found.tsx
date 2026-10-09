import Link from "next/link";
import { Button } from "@/components/ui/button";

// Dipakai untuk semua alamat yang tidak ada dan semua notFound() (termasuk
// halaman yang sengaja disembunyikan dari akun tanpa izin, mis. /admin untuk
// akun biasa). Karena itu teksnya TIDAK boleh menyebut izin, akses, atau hak:
// pengunjung tidak boleh bisa membedakan "tidak ada" dari "ada tetapi dilarang".
// Tombolnya ke "/", yang mengalihkan ke dasbor (sudah masuk) atau halaman masuk.
export default function NotFound() {
  return (
    <main id="main-content" className="mx-auto max-w-lg px-6 py-24">
      <p className="mb-3 font-mono text-sm text-primary">404</p>
      <h1 className="text-3xl font-semibold tracking-tight">
        Halaman tidak ditemukan
      </h1>
      <p className="my-4 text-muted-foreground">
        Alamat ini tidak ada. Kembali ke awal untuk melanjutkan.
      </p>
      <Button asChild>
        <Link href="/">Kembali ke beranda</Link>
      </Button>
    </main>
  );
}
