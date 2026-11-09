import type { Metadata } from "next";
import Link from "next/link";
import { WhatsappLogBoard } from "@/components/dashboard/whatsapp-log-board";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Riwayat Notifikasi WhatsApp" };

export default async function WhatsappLogPage() {
  await requireSession();
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/app/alert"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Kembali ke Alert
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Riwayat Notifikasi WhatsApp
          </h1>
        </div>
        <Link
          href="/app/alert/whatsapp/penerima"
          className="inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Kelola Penerima Notifikasi WhatsApp →
        </Link>
      </div>
      <WhatsappLogBoard />
    </div>
  );
}
