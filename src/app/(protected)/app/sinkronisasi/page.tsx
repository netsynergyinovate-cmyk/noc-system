import type { Metadata } from "next";
import { MockDataNotice } from "@/components/dashboard/mock-data-notice";
import { DataSyncBoard } from "@/components/dashboard/data-sync-board";
import { SeedSummary } from "@/components/dashboard/seed-summary";
import { LocalToServerTransfer } from "@/components/dashboard/local-to-server-transfer";
import { AutoAlignmentStatus } from "@/components/dashboard/auto-alignment-status";
import { SyncHistoryPanel } from "@/components/dashboard/sync-history-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Status Sinkronisasi & Riwayat Data - NOC ISP",
};

export default async function DataSyncPage() {
  await requireSession();

  return (
    <div
      data-testid="data-sync-page"
      className="mx-auto flex max-w-7xl flex-col gap-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Sinkronisasi & Penyelarasan Data
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Penyelarasan otomatis telemetri jaringan, transfer data lokal ke server, riwayat sinkronisasi, dan seed data awal.
          </p>
        </div>
        <MockDataNotice source="riwayat & status sinkronisasi data" />
      </div>

      <Tabs defaultValue="sync" className="gap-6">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="sync" data-testid="tab-data-sync">
            Status Sinkronisasi
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-sync-history">
            Riwayat Sinkronisasi
          </TabsTrigger>
          <TabsTrigger value="alignment" data-testid="tab-auto-alignment">
            Penyelarasan Otomatis
          </TabsTrigger>
          <TabsTrigger value="transfer" data-testid="tab-transfer-status">
            Transfer Lokal → Server
          </TabsTrigger>
          <TabsTrigger value="seed" data-testid="tab-seed-summary">
            Seed Data Awal
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sync" className="flex flex-col gap-6 mt-4">
          <DataSyncBoard />
        </TabsContent>

        <TabsContent value="history" className="flex flex-col gap-6 mt-4">
          <SyncHistoryPanel />
        </TabsContent>

        <TabsContent value="alignment" className="flex flex-col gap-6 mt-4">
          <AutoAlignmentStatus />
        </TabsContent>

        <TabsContent value="transfer" className="flex flex-col gap-6 mt-4">
          <LocalToServerTransfer />
        </TabsContent>

        <TabsContent value="seed" className="flex flex-col gap-6 mt-4">
          <SeedSummary />
        </TabsContent>
      </Tabs>
    </div>
  );
}
