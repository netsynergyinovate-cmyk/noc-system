import type { Metadata } from "next";
import Link from "next/link";
import { AlertBoard } from "@/components/dashboard/alert-board";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Alert" };

export default async function AlertsPage() {
  const { user } = await requireSession();
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Alert
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <MockDataNotice real />
            <Link
              href="/app/alert/whatsapp"
              className="text-xs sm:text-sm text-primary underline-offset-4 hover:underline"
            >
              Riwayat Notifikasi WhatsApp →
            </Link>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Gangguan yang masih berjalan, dari yang paling genting dan paling
          baru, lalu catatan gangguan yang sudah selesai.
        </p>
      </div>
      {/* Atas nama siapa alert ditandai ditangani. Backend sungguhan mengambilnya
          dari sesi sendiri; nama ini hanya untuk server tiruan dan tampilan. */}
      <AlertBoard operator={user.name || user.email} />
    </div>
  );
}
