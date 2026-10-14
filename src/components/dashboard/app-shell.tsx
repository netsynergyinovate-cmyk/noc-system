import { Brand } from "@/components/brand";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { AdminLink } from "./admin-link";
import { AlertSoundToggle } from "./alert-sound-toggle";
import { AppNav } from "./app-nav";
import { ConfigurationStatusBadge } from "./configuration-status-badge";
import { RoleBadge } from "./role-badge";

// Merek yang sama dengan halaman masuk, tetapi menuju dasbor.
export function NocBrand() {
  return <Brand href="/app" />;
}

// Komponen server tanpa state: header dan sidebar tidak ikut digambar ulang
// saat data per detik masuk ke bagian utama. Tautan admin menentukan sendiri
// apakah tampil, dari peran di store sesi (lihat admin-link.tsx).
export function AppShell({
  user,
  locked = false,
  children,
}: {
  user: { email: string };
  locked?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* overflow-y-auto: di layar pendek (mis. 1366x768) isi sidebar lebih tinggi
          dari layar; tanpa itu tombol Keluar terpotong dan tak terjangkau. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r bg-card px-4 py-5 lg:flex">
        <div className="flex flex-col gap-2.5">
          <NocBrand />
          <ConfigurationStatusBadge incomplete={locked} />
        </div>
        <AppNav variant="sidebar" locked={locked} />
        <div className="flex flex-col items-start gap-3 border-t pt-4">
          <ThemeToggle />
          <AlertSoundToggle />
          <p className="w-full text-xs break-all text-muted-foreground">
            Masuk sebagai {user.email}
          </p>
          <RoleBadge variant="sidebar" />
          <AdminLink />
          <SignOutButton />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3 lg:hidden">
          <NocBrand />
          <div className="flex flex-wrap items-center gap-2">
            <ConfigurationStatusBadge incomplete={locked} />
            <ThemeToggle />
            <AlertSoundToggle />
            <AdminLink />
            <SignOutButton />
            <RoleBadge variant="bar" />
          </div>
          {/* min-w-0: tanpa itu lebar minimum pembungkus mengikuti seluruh daftar menu
              (nowrap), header melebihi layar, dan menu tidak sempat menggulir di
              dalam dirinya sendiri. */}
          <div className="w-full min-w-0">
            <AppNav variant="bar" locked={locked} />
          </div>
        </header>
        <main
          id="main-content"
          className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
