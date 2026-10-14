import type { Metadata } from "next";
import Link from "next/link";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { WhatsappRecipientsManager } from "@/components/dashboard/whatsapp-recipients-manager";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Kelola Penerima WhatsApp" };

export default async function WhatsappRecipientsPage() {
  await requireSession();
  const back = "text-sm text-muted-foreground hover:text-foreground";
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/app/alert/whatsapp" className={back}>
              ← Riwayat Notifikasi WhatsApp
            </Link>
            <Link href="/app/alert" className={back}>
              ← Alert
            </Link>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Kelola Penerima Notifikasi WhatsApp
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Daftar nomor telepon operator dan ID grup WhatsApp yang menerima pemberitahuan otomatis
            saat terjadi alert gangguan jaringan.
          </p>
        </div>
        <MockDataNotice source="pengaturan notifikasi WhatsApp" />
      </div>
      <WhatsappRecipientsManager />
    </div>
  );
}
