import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { GenieacsBoard } from "@/components/dashboard/genieacs-board";

export const metadata: Metadata = {
  title: "GenieACS TR-069 Server",
  description: "Manajemen terpusat modem ONT / CPE pelanggan via protokol TR-069 GenieACS NBI.",
};

export default async function GenieacsPage() {
  await requireSession();

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <GenieacsBoard />
    </div>
  );
}

