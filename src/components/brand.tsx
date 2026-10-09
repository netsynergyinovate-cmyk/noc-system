import Link from "next/link";
import { Activity } from "lucide-react";

// Merek NOC ISP: ikon dalam kotak dan nama. Dipakai halaman masuk/daftar dan
// layout admin. Namanya sudah terbaca dari teksnya, jadi tidak perlu aria-label.
export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2.5 rounded-sm font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background">
        <Activity className="size-4" aria-hidden="true" />
      </span>
      NOC ISP
    </Link>
  );
}
