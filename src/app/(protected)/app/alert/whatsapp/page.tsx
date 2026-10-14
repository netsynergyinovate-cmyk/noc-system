import type { Metadata } from "next";
import Link from "next/link";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { WhatsappLogBoard } from "@/components/dashboard/whatsapp-log-board";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Riwayat Notifikasi WhatsApp" };

export default async function WhatsappLogPage() {
  await requireSession();
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/app/alert"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Kembali ke Alert
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Riwayat Notifikasi WhatsApp
          </h1>
          <Link
            href="/app/alert/whatsapp/penerima"
            className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Kelola Penerima Notifikasi WhatsApp →
          </Link>
        </div>
        <MockDataNotice source="gateway log WhatsApp di backend" />
      </div>
      <WhatsappLogBoard />
    </div>
  );
}
