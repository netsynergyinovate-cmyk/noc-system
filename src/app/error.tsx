"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

// Halaman galat tak terduga (error boundary akar). Memberi dua jalan: mencoba
// lagi, atau kembali ke awal ("/" mengalihkan ke dasbor atau halaman masuk).
// `retry` (Next 16.3) memuat ulang data dari server lalu mengosongkan galat;
// `reset` hanya mengosongkan galat dan merender ulang isi yang sama, jadi galat
// dari server akan terulang. `reset` tetap dipakai bila `retry` tidak ada.
export default function ErrorPage({
  reset,
  retry,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  retry?: () => void;
}) {
  return (
    <main id="main-content" className="mx-auto max-w-lg px-6 py-24">
      <h1 className="text-2xl font-semibold">Terjadi kesalahan</h1>
      <p className="my-4 leading-7 text-muted-foreground">
        Coba muat halaman ini lagi. Bila terus terjadi, hubungi admin NOC.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => (retry ?? reset)()}>Coba lagi</Button>
        <Button asChild variant="outline">
          <Link href="/">Kembali ke beranda</Link>
        </Button>
      </div>
    </main>
  );
}
