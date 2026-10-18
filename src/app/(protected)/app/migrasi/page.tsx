import type { Metadata } from "next";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { SchemaMigrationsBoard } from "@/components/dashboard/schema-migrations-board";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Riwayat Migrasi Skema - NOC ISP",
};

export default async function SchemaMigrationsPage() {
  await requireSession();

  return (
    <div
      data-testid="schema-migrations-page"
      className="flex w-full flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Riwayat Migrasi Skema
          </h1>
          <MockDataNotice source="riwayat migrasi database" />
        </div>
        <p className="text-sm text-muted-foreground">
          Status penerapan skema Drizzle ORM, advisory lock, dan tabel pelacak database.
        </p>
      </div>

      <SchemaMigrationsBoard />
    </div>
  );
}
