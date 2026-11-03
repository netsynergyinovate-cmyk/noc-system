"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  ChevronRight,
  Layers,
  LayoutDashboard,
  LayoutGrid,
  Network,
  Receipt,
  ScrollText,
  Settings,
  Siren,
  TrendingUp,
  Users,
  Router,
  Radio,
  MapPin,
  KeyRound,
  Server,
  Crosshair,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { AlertCountAnnouncement, AlertCountBadge } from "./alert-count-badge";
import { useCanDo } from "@/components/access";
import type { Capability } from "@/lib/access";
import { isPathExemptFromGate } from "@/lib/dashboard/onboarding-gate";

interface NavItem {
  label: string;
  Icon: LucideIcon;
  // Kosong berarti halamannya belum ada.
  href?: string;
  // Menunya memuat lencana jumlah alert aktif.
  alerts?: true;
  capability?: Capability;
  onClick?: () => void;
}

interface NavCategory {
  title: string;
  Icon: LucideIcon;
  items: NavItem[];
}

const dashboardItem: NavItem = {
  label: "Dashboard",
  href: "/app",
  Icon: LayoutDashboard,
};

const navCategories: NavCategory[] = [
  {
    title: "Apps",
    Icon: LayoutGrid,
    items: [
      { label: "Alert", href: "/app/alert", Icon: Bell, alerts: true },
      { label: "Deteksi Anomali", href: "/app/anomali", Icon: Siren },
      { label: "NetFlow", href: "/app/netflow", Icon: Activity },
      { label: "Trafik", href: "/app/traffic", Icon: TrendingUp },
    ],
  },
  {
    title: "Infrastruktur",
    Icon: Layers,
    items: [
      { label: "Router", href: "/app/router", Icon: Router },
      { label: "OLT & Optik", href: "/app/cpe", Icon: Network },
      { label: "Peta Jaringan", href: "/app/peta", Icon: MapPin },
      { label: "GenieACS (TR-069)", href: "/app/genieacs", Icon: Radio },
    ],
  },
  {
    title: "Pelanggan & Billing",
    Icon: Users,
    items: [
      { label: "Pelanggan", href: "/app/pelanggan", Icon: Users },
      { label: "Billing", href: "/app/billing", Icon: Receipt },
    ],
  },
  {
    title: "Sistem",
    Icon: Settings,
    items: [
      { label: "Pengaturan", href: "/app/pengaturan", Icon: Settings },
      { label: "Jejak Aktivitas", href: "/app/jejak-aktivitas", Icon: ScrollText },
      { label: "API Key", href: "/app/api-key", Icon: KeyRound },
      { label: "Uji Stack", href: "/app/uji-stack", Icon: Layers },
      { label: "Deploy Server", href: "/app/deploy", Icon: Server, capability: "manageDeploy" },
      {
        label: "Tandai Fitur",
        Icon: Crosshair,
        onClick: () => {
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("open-feature-marker-inspector"));
          }
        },
      },
    ],
  },
];

// Daftar datar untuk bar horizontal layar sempit
const navItems: NavItem[] = [dashboardItem, ...navCategories.flatMap((cat) => cat.items)];

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
  const canManageDeploy = useCanDo("manageDeploy");
  const isItemVisible = (item: NavItem) =>
    !item.capability || (item.capability === "manageDeploy" && canManageDeploy);
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
          {navItems.filter(isItemVisible).map(({ label, href, Icon, alerts, onClick }) => {
            if (onClick) {
              return (
                <li key={label}>
                  <button
                    type="button"
                    onClick={onClick}
                    className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap text-purple-600 dark:text-purple-400 hover:bg-purple-500/10 cursor-pointer"
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {label}
                  </button>
                </li>
              );
            }
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

  const isDashboardActive = isCurrent(pathname, "/app");

  return (
    <nav aria-label="Menu utama" className="flex-1 space-y-3">
      {/* Item Utama: Dashboard */}
      <div className="space-y-1">
        <Link
          href="/app"
          aria-current={isDashboardActive ? "page" : undefined}
          className={cn(
            "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150",
            isDashboardActive
              ? "bg-primary/10 text-primary font-semibold shadow-xs dark:bg-primary/15 dark:text-primary"
              : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
          )}
        >
          <LayoutDashboard
            className={cn(
              "size-4 shrink-0 transition-transform duration-150 group-hover:scale-105",
              isDashboardActive
                ? "text-primary"
                : "text-muted-foreground group-hover:text-foreground",
            )}
            aria-hidden="true"
          />
          <span className="truncate">Dashboard</span>
        </Link>
      </div>
      {/* Kategori Beranak (Accordion Menu) */}
      <div className="space-y-1.5">
        {navCategories.map((category) => {
          const isOpen = openCategories[category.title] ?? true;
          const visibleItems = category.items.filter(isItemVisible);
          if (visibleItems.length === 0) return null;
          const hasActiveItem = visibleItems.some(
            (item) => item.href && isCurrent(pathname, item.href),
          );
          const CategoryIcon = category.Icon;

          return (
            <div key={category.title} className="space-y-1">
              <button
                type="button"
                onClick={() => toggleCategory(category.title)}
                aria-expanded={isOpen}
                className={cn(
                  "group flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 cursor-pointer",
                  hasActiveItem
                    ? "text-foreground font-semibold"
                    : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground",
                )}
              >
                <div className="flex items-center gap-3">
                  <CategoryIcon
                    className={cn(
                      "size-4 shrink-0 transition-colors",
                      hasActiveItem
                        ? "text-blue-500 dark:text-blue-400"
                        : "text-muted-foreground group-hover:text-foreground",
                    )}
                    aria-hidden="true"
                  />
                  <span className="truncate">{category.title}</span>
                </div>
                <ChevronRight
                  className={cn(
                    "size-3.5 text-muted-foreground/60 transition-transform duration-200",
                    isOpen ? "rotate-90 text-foreground" : "rotate-0",
                  )}
                  aria-hidden="true"
                />
              </button>

              {isOpen && (
                <div className="ml-4 pl-3.5 border-l border-border/50 space-y-0.5 my-1">
                  <ul className="flex flex-col gap-0.5">
                    {visibleItems.map(({ label, href, Icon, alerts, onClick }) => {
                      if (onClick) {
                        return (
                          <li key={label}>
                            <button
                              type="button"
                              onClick={onClick}
                              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-purple-600 dark:text-purple-400 hover:bg-purple-500/15 cursor-pointer transition-colors"
                            >
                              <div className="flex items-center gap-2.5 truncate">
                                <Icon className="size-3.5 shrink-0 text-purple-600 dark:text-purple-400" aria-hidden="true" />
                                <span className="truncate">{label}</span>
                              </div>
                              <kbd className="rounded border border-purple-500/30 bg-purple-500/15 px-1 py-0.5 font-mono text-[9px] font-medium text-purple-600 dark:text-purple-300">
                                Ctrl+~
                              </kbd>
                            </button>
                          </li>
                        );
                      }
                      const isItemLocked = locked && !isPathExemptFromGate(href);
                      const isItemActive = href && isCurrent(pathname, href);
                      return (
                        <li key={label}>
                          {href && !isItemLocked ? (
                            <>
                              <Link
                                href={href}
                                aria-current={isItemActive ? "page" : undefined}
                                aria-describedby={alerts ? alertsId : undefined}
                                className={cn(
                                  "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                                  isItemActive
                                    ? "bg-primary/10 text-primary font-semibold shadow-2xs dark:bg-primary/15 dark:text-primary"
                                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                                )}
                              >
                                <Icon
                                  className={cn(
                                    "size-3.5 shrink-0",
                                    isItemActive
                                      ? "text-primary"
                                      : "text-muted-foreground/70",
                                  )}
                                  aria-hidden="true"
                                />
                                <span className="truncate">{label}</span>
                                {alerts && <AlertCountBadge className="ml-auto" />}
                              </Link>
                              {alerts && <AlertCountAnnouncement id={alertsId} />}
                            </>
                          ) : (
                            <span
                              aria-disabled="true"
                              className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground"
                            >
                              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
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
      </div>
    </nav>
  );
}
