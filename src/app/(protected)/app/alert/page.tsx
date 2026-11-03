import type { Metadata } from "next";
import Link from "next/link";
import { AlertBoard } from "@/components/dashboard/alert-board";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Alert" };

// Tab satu halaman Alert & Notifikasi (PRD notifikasi-alert-kesehatan-perangkat
// §3.3). Papan Alert ada di sini; penerima dan catatan kirim masih rute
// sendiri di bawah /app/alert/whatsapp. Tab Kebijakan belum ada karena
// tabelnya (notification_policies) belum dibuat.
const tabs = [
  { href: "/app/alert", label: "Papan Alert", current: true },
  { href: "/app/alert/whatsapp/penerima", label: "Penerima & Kanal" },
  { href: "/app/alert/whatsapp", label: "Catatan Pengiriman" },
];

export default async function AlertsPage() {
  const { user } = await requireSession();
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b pb-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight">Alert</h1>
          <MockDataNotice real />
        </div>
        <nav aria-label="Tab Alert" className="flex gap-1 font-mono text-[11px]">
          {tabs.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={tab.current ? "page" : undefined}
              className="rounded border px-2 py-1 text-muted-foreground hover:text-foreground aria-[current=page]:bg-secondary aria-[current=page]:font-semibold aria-[current=page]:text-foreground"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
      {/* Atas nama siapa alert ditandai ditangani. Backend sungguhan mengambilnya
          dari sesi sendiri; nama ini hanya untuk server tiruan dan tampilan. */}
      <AlertBoard operator={user.name || user.email} />
    </div>
  );
}
