"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  ChevronDown,
  Database,
  Download,
  Layers,
  LayoutDashboard,
  Network,
  Receipt,
  ScrollText,
  Settings,
  Siren,
  TrendingUp,
  Users,
  RefreshCw,
  Router,
  Server,
  ShieldCheck,
  Compass,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { AlertCountAnnouncement, AlertCountBadge } from "./alert-count-badge";
import { isPathExemptFromGate } from "@/lib/dashboard/onboarding-gate";

interface NavItem {
  label: string;
  Icon: LucideIcon;
  // Kosong berarti halamannya belum ada.
  href?: string;
  // Menunya memuat lencana jumlah alert aktif.
  alerts?: true;
}

interface NavCategory {
  title: string;
  items: NavItem[];
}

const navCategories: NavCategory[] = [
  {
    title: "Monitoring",
    items: [
      { label: "Dashboard", href: "/app", Icon: LayoutDashboard },
      { label: "Alert", href: "/app/alert", Icon: Bell, alerts: true },
      { label: "Deteksi Anomali", href: "/app/anomali", Icon: Siren },
      { label: "NetFlow", href: "/app/netflow", Icon: Activity },
      { label: "Trafik", href: "/app/traffic", Icon: TrendingUp },
    ],
  },
  {
    title: "Infrastruktur",
    items: [
      { label: "Router", href: "/app/router", Icon: Router },
      { label: "Setup Wisaya", href: "/setup", Icon: Compass },
      { label: "OLT & Optik", href: "/app/cpe", Icon: Network },
      { label: "Integrasi Perangkat", href: "/app/pengaturan/perangkat", Icon: Server },
    ],
  },
  {
    title: "Pelanggan & Billing",
    items: [
      { label: "Pelanggan", href: "/app/pelanggan", Icon: Users },
      { label: "Billing", href: "/app/billing", Icon: Receipt },
    ],
  },
  {
    title: "Sistem",
    items: [
      { label: "Pusat Onboarding", href: "/app/onboarding", Icon: Compass },
      { label: "Pengaturan", href: "/app/pengaturan", Icon: Settings },
      { label: "Migrasi Skema", href: "/app/migrasi", Icon: Database },
      { label: "Sinkronisasi Data", href: "/app/sinkronisasi", Icon: RefreshCw },
      { label: "Pengaman Deploy", href: "/app/pengaman-deploy", Icon: ShieldCheck },
      { label: "Jejak Aktivitas", href: "/app/jejak-aktivitas", Icon: ScrollText },
      { label: "Ekspor Data", href: "/app/ekspor", Icon: Download },
      { label: "Uji Stack", href: "/app/uji-stack", Icon: Layers },
    ],
  },
];

// Daftar datar untuk bar horizontal layar sempit
const navItems: NavItem[] = navCategories.flatMap((cat) => cat.items);

// "/app" hanya cocok persis; halaman lain cocok bersama anak-anaknya.
function isCurrent(pathname: string, href: string) {
  return href === "/app"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

// Hanya menu ini yang tahu halaman aktif, jadi sisa sidebar tetap komponen
// server yang tidak ikut digambar ulang. Lencana alert berlangganan store sendiri
// (komponen anaknya), jadi menu ini tidak digambar ulang oleh pesan alert.
export function AppNav({
  variant,
  locked = false,
}: {
  variant: "sidebar" | "bar";
  // Terkunci: belum ada perangkat terhubung, semua menu tidak bisa dibuka.
  locked?: boolean;
}) {
  const pathname = usePathname();
  // Satu untuk tiap menu: sidebar dan bilah sempit sama-sama ada di halaman
  // (salah satunya disembunyikan CSS), jadi id-nya tidak boleh sama.
  const alertsId = useId();

  // Status buka/tutup per kategori di sidebar (default terbuka agar mudah diakses)
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(navCategories.map((c) => [c.title, true])),
  );

  const toggleCategory = (title: string) => {
    setOpenCategories((prev) => ({
      ...prev,
      [title]: !prev[title],
    }));
  };

  if (variant === "bar") {
    // Untuk layar sempit: hanya halaman yang sudah ada, bisa digulir mendatar.
    return (
      <nav aria-label="Menu halaman" className="-mx-1 overflow-x-auto">
        <ul className="flex gap-1 px-1">
          {navItems.map(({ label, href, Icon, alerts }) => {
            const isItemLocked = locked && !isPathExemptFromGate(href);
            return href ? (
              isItemLocked ? (
                <li key={label}>
                  <span
                    aria-disabled="true"
                    className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground"
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {label}
                    <span className="rounded-full border px-2 py-0.5 text-[10px] leading-4">
                      Terkunci
                    </span>
                  </span>
                </li>
              ) : (
              <li key={label}>
                <Link
                  href={href}
                  aria-current={isCurrent(pathname, href) ? "page" : undefined}
                  aria-describedby={alerts ? alertsId : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap",
                    isCurrent(pathname, href)
                      ? "bg-secondary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                  {alerts && <AlertCountBadge />}
                </Link>
                {alerts && <AlertCountAnnouncement id={alertsId} />}
              </li>
              )
            ) : null;
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="Menu utama" className="flex-1 space-y-3">
      {navCategories.map((category) => {
        const isOpen = openCategories[category.title] ?? true;
        const hasActiveItem = category.items.some(
          (item) => item.href && isCurrent(pathname, item.href),
        );

        return (
          <div key={category.title} className="space-y-1">
            <button
              type="button"
              onClick={() => toggleCategory(category.title)}
              aria-expanded={isOpen}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
                hasActiveItem
                  ? "text-foreground font-bold"
                  : "text-muted-foreground/70 hover:bg-secondary/40 hover:text-foreground",
              )}
            >
              <span>{category.title}</span>
              <ChevronDown
                className={cn(
                  "size-3.5 transition-transform duration-200 text-muted-foreground/70",
                  isOpen ? "rotate-0" : "-rotate-90",
                )}
                aria-hidden="true"
              />
            </button>

            {isOpen && (
              <div className="ml-3 border-l border-border/50 pl-2">
                <ul className="flex flex-col gap-0.5">
                  {category.items.map(({ label, href, Icon, alerts }) => {
                    const isItemLocked = locked && !isPathExemptFromGate(href);
                    return (
                      <li key={label}>
                        {href && !isItemLocked ? (
                          <>
                            <Link
                              href={href}
                              aria-current={isCurrent(pathname, href) ? "page" : undefined}
                              aria-describedby={alerts ? alertsId : undefined}
                              className={cn(
                                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                                isCurrent(pathname, href)
                                  ? "bg-secondary font-medium text-foreground"
                                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                              )}
                            >
                              <Icon className="size-4 shrink-0" aria-hidden="true" />
                              <span className="truncate">{label}</span>
                              {alerts && <AlertCountBadge className="ml-auto" />}
                            </Link>
                            {alerts && <AlertCountAnnouncement id={alertsId} />}
                          </>
                        ) : (
                          <span
                            aria-disabled="true"
                            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground"
                          >
                            <Icon className="size-4 shrink-0" aria-hidden="true" />
                            <span className="truncate">{label}</span>
                            <span className="ml-auto rounded-full border px-1.5 py-0.5 text-[10px] leading-3">
                              {href ? "Terkunci" : "Segera"}
                            </span>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
