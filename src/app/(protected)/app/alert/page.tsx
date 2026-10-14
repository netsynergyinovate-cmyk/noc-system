import type { Metadata } from "next";
import Link from "next/link";
import { AlertBoard } from "@/components/dashboard/alert-board";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Alert" };

export default async function AlertsPage() {
  const { user } = await requireSession();
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Alert
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gangguan yang masih berjalan, dari yang paling genting dan paling
            baru, lalu catatan gangguan yang sudah selesai.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <MockDataNotice />
          <Link
            href="/app/alert/whatsapp"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Riwayat Notifikasi WhatsApp →
          </Link>
        </div>
      </div>
      {/* Atas nama siapa alert ditandai ditangani. Backend sungguhan mengambilnya
          dari sesi sendiri; nama ini hanya untuk server tiruan dan tampilan. */}
      <AlertBoard operator={user.name || user.email} />
    </div>
  );
}
