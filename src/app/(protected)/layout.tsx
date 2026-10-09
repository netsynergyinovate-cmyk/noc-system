import { SessionProvider } from "@/components/session-provider";
import { SessionSync } from "@/components/session-sync";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";

// Gerbang login, lalu menyalurkan sesi asli ke store sesi untuk TAMPILAN
// (SessionProvider membuat satu store per permintaan, bukan store bersama).
// Tampilan tiap area ada di layout masing-masing. Server tetap memeriksa peran
// asli di setiap halaman dan API; store ini bukan pemeriksaan akses.
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireSession();
  return (
    <SessionProvider
      // Hanya empat bidang ini yang sampai ke browser, bukan seluruh objek sesi.
      user={{
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role ?? null,
      }}
      // Mode demo memperbolehkan mencoba tampilan peran lain (hanya tampilan).
      previewEnabled={env.DASHBOARD_DATA === "demo"}
    >
      {/* Keluar di tab lain memindahkan tab ini ke halaman masuk (semua area
          terlindungi: aplikasi, setup, admin). */}
      <SessionSync />
      {children}
    </SessionProvider>
  );
}
