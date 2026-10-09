import { redirect } from "next/navigation";
import { Activity, MapPin, Siren, type LucideIcon } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { getSession } from "@/lib/session";
import { siteConfig } from "@/config/site";

const highlights: { Icon: LucideIcon; text: string }[] = [
  { Icon: Activity, text: "Status online/offline tampil kurang dari 1 detik" },
  { Icon: Siren, text: "Alert otomatis saat gangguan muncul" },
  { Icon: MapPin, text: "Peta sebaran pelanggan merah, kuning, hijau" },
];

// Hiasan statis: dua garis lalu lintas dengan isi gradien lembut, tanpa angka
// dan tanpa gerak. Warnanya dari token tema (--chart-1, --chart-2, --border),
// jadi ikut berganti di tema gelap. Tidak dibaca pembaca layar. Melebar sampai
// tepi panel; tinggi tetap dan non-scaling-stroke menjaga tebal garisnya.
function TrafficIllustration() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 480 150"
      preserveAspectRatio="none"
      fill="none"
      className="block h-36 w-full"
    >
      <defs>
        <linearGradient id="auth-traffic-fill" x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0"
            style={{ stopColor: "var(--chart-1)", stopOpacity: 0.24 }}
          />
          <stop
            offset="1"
            style={{ stopColor: "var(--chart-1)", stopOpacity: 0 }}
          />
        </linearGradient>
      </defs>
      <g
        strokeWidth="1"
        strokeDasharray="2 6"
        strokeLinecap="round"
        style={{ stroke: "var(--border)" }}
      >
        <line x1="0" y1="30" x2="480" y2="30" />
        <line x1="0" y1="70" x2="480" y2="70" />
        <line x1="0" y1="110" x2="480" y2="110" />
      </g>
      <path
        d="M0 112 L28 104 L56 108 L84 92 L112 98 L140 80 L168 86 L196 66 L224 72 L252 52 L280 60 L308 40 L336 48 L364 34 L392 42 L420 26 L448 34 L480 22 L480 150 L0 150 Z"
        fill="url(#auth-traffic-fill)"
      />
      <path
        d="M0 112 L28 104 L56 108 L84 92 L112 98 L140 80 L168 86 L196 66 L224 72 L252 52 L280 60 L308 40 L336 48 L364 34 L392 42 L420 26 L448 34 L480 22"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={{ stroke: "var(--chart-1)" }}
      />
      <path
        d="M0 128 L28 124 L56 130 L84 118 L112 122 L140 112 L168 118 L196 106 L224 112 L252 100 L280 108 L308 96 L336 104 L364 94 L392 100 L420 90 L448 96 L480 86"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={{ stroke: "var(--chart-2)" }}
      />
    </svg>
  );
}

// Tata letak halaman masuk dan daftar. Di layar lebar (lg) ada panel
// pengenalan di kiri dan formulir di kanan; di bawah itu panel disembunyikan
// supaya formulir tampil pertama.
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (await getSession()) redirect(siteConfig.homePath);
  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside
        aria-label="Tentang NOC ISP"
        className="hidden flex-col overflow-hidden border-r bg-card lg:flex"
      >
        <div className="flex flex-1 flex-col gap-12 p-10 xl:p-14">
          {/* Dibungkus supaya tautannya selebar teksnya, bukan selebar panel. */}
          <div>
            <Brand />
          </div>
          {/* my-auto: teks berada di tengah ruang antara merek dan ilustrasi. */}
          <div className="my-auto max-w-md space-y-8">
            <div className="space-y-4">
              {/* Bukan judul: panel ada di depan formulir dalam urutan baca, dan
                  judul halaman harus tetap h1 formulir, bukan h2 yang terbaca
                  lebih dulu. */}
              <p className="text-4xl leading-tight font-semibold tracking-tight text-balance">
                Seluruh jaringan, satu layar.
              </p>
              <p className="text-lg leading-8 text-muted-foreground">
                Pantau pelanggan PPPoE, router, dan sinyal optik secara
                real-time.
              </p>
            </div>
            <ul className="space-y-4">
              {highlights.map(({ Icon, text }) => (
                <li key={text} className="flex items-start gap-3 text-sm">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="pt-1.5 leading-5">{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <TrafficIllustration />
      </aside>
      <div className="flex min-h-svh min-w-0 flex-col">
        <header className="flex items-center justify-between gap-4 px-6 py-6 sm:px-10">
          {/* Di lg merek sudah ada di panel kiri. */}
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <main
          id="main-content"
          className="flex flex-1 items-center justify-center px-6 py-12"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
