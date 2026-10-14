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
      className="mx-auto flex max-w-7xl flex-col gap-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Riwayat Migrasi Skema
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Status penerapan skema Drizzle ORM, advisory lock, dan tabel pelacak database.
          </p>
        </div>
        <MockDataNotice source="riwayat migrasi database" />
      </div>

      <SchemaMigrationsBoard />
    </div>
  );
}
