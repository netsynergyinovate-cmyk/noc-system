import Link from "next/link";
import { Activity } from "lucide-react";

// Merek NOC ISP: ikon dalam kotak dan nama. Dipakai halaman masuk/daftar dan
// layout admin. Namanya sudah terbaca dari teksnya, jadi tidak perlu aria-label.
export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2.5 rounded-lg py-1 font-semibold tracking-tight text-foreground transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
        <Activity className="size-3.5 stroke-[2.2]" aria-hidden="true" />
      </span>
      <span className="text-sm font-bold tracking-tight">NOC ISP</span>
    </Link>
  );
}
