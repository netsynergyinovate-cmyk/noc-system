import Link from "next/link";
import { Brand } from "@/components/brand";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Can } from "@/components/access";
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
        <div className="flex flex-col gap-2">
          <NocBrand />
          <ConfigurationStatusBadge incomplete={locked} />
        </div>
        <AppNav variant="sidebar" locked={locked} />
        <div className="mt-auto flex flex-col gap-2.5 border-t border-border/60 pt-3">
          {/* Kontrol Tema & Suara Minimalis */}
          <div className="flex items-center justify-between gap-1">
            <ThemeToggle />
            <AlertSoundToggle />
          </div>

          {/* Menu Profil Akun Minimalis */}
          <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/20 p-2.5">
            <Link
              href="/app/pengaturan/akun"
              title="Buka Pengaturan Akun & Profil"
              className="group flex items-center gap-2.5 min-w-0 transition-opacity hover:opacity-85"
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-semibold text-xs border border-primary/20">
                {user.email.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs font-medium text-foreground group-hover:text-primary transition-colors">
                  {user.email}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Profil &amp; Akun
                </span>
              </div>
            </Link>
            <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <RoleBadge variant="sidebar" />
                <Can to="adminArea">
                  <Link
                    href="/admin"
                    title="Buka panel admin"
                    className="text-[10px] text-muted-foreground hover:text-foreground font-mono underline"
                  >
                    Admin
                  </Link>
                </Can>
              </div>
              <SignOutButton />
            </div>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3 lg:hidden">
          <NocBrand />
          <div className="flex flex-wrap items-center gap-2">
            <ConfigurationStatusBadge incomplete={locked} />
            <ThemeToggle />
            <AlertSoundToggle />
            <Can to="adminArea">
              <Link
                href="/admin"
                title="Buka panel admin"
                className="text-xs text-muted-foreground hover:text-foreground font-mono underline"
              >
                Admin
              </Link>
            </Can>
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
          className="flex-1 px-4 py-5 sm:px-6 lg:px-6 lg:py-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
