"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Database,
  KeyRound,
  RefreshCw,
  Server,
  ShieldAlert,
  Sliders,
  Sparkles,
  Users,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getMockSeedDataList,
  getMockSeedSummaryOverview,
  type SeedDataItem,
} from "@/lib/dashboard/seed-data";

export function SeedSummary() {
  const [items, setItems] = useState<readonly SeedDataItem[]>(() =>
    getMockSeedDataList(),
  );
  const [isVerifying, setIsVerifying] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const overview = useMemo(() => getMockSeedSummaryOverview(items), [items]);

  const handleVerifySeed = () => {
    setIsVerifying(true);
    setFeedback(null);
    setTimeout(() => {
      setIsVerifying(false);
      setItems((prev) =>
        prev.map((i) => ({
          ...i,
          status: "seeded",
          lastSeededAt: new Date().toISOString(),
        })),
      );
      setFeedback(
        "Seluruh data awal (seed accounts, thresholds, devices, recipients) terverifikasi utuh dan idempoten.",
      );
    }, 600);
  };

  const getCategoryIcon = (category: SeedDataItem["category"]) => {
    switch (category) {
      case "accounts":
        return <Users className="h-4 w-4 text-blue-500" />;
      case "thresholds":
        return <Sliders className="h-4 w-4 text-purple-500" />;
      case "devices":
        return <Server className="h-4 w-4 text-emerald-500" />;
      case "whatsapp":
        return <Smartphone className="h-4 w-4 text-emerald-600" />;
      case "billing":
        return <Database className="h-4 w-4 text-sky-500" />;
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="seed-summary">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Status Seed Awal</CardDescription>
            <CardTitle className="text-xl font-bold flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full bg-emerald-500" />
              {overview.overallStatus === "ready"
                ? "Tersedia Lengkap"
                : "Perlu Seed"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {overview.seededCategories} dari {overview.totalCategories} modul terpasang
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Record Tersemas</CardDescription>
            <CardTitle className="text-xl font-bold">
              {overview.totalRecords} Entri
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Akun default, ambang alert, perangkat
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Jaminan Idempotensi</CardDescription>
            <CardTitle className="text-xl font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="h-5 w-5" />
              100% Aman
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Dapat dijalankan berulang tanpa duplikasi
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Verifikasi Terakhir</CardDescription>
            <CardTitle className="text-sm font-semibold truncate">
              {overview.lastVerifiedAt
                ? new Date(overview.lastVerifiedAt).toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  }) + " WIB"
                : "-"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Sinkronisasi startup kontainer
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Banner Feedback */}
      {feedback && (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300 flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{feedback}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFeedback(null)}
            className="h-7 text-xs"
          >
            Tutup
          </Button>
        </div>
      )}

      {/* Action Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Katalog Data Seed Inisialisasi
          </h2>
          <p className="text-xs text-muted-foreground">
            Daftar entitas awal yang diinjeksikan secara otomatis saat instalasi pertama dan upgrade sistem.
          </p>
        </div>

        <Button
          onClick={handleVerifySeed}
          disabled={isVerifying}
          className="gap-2"
          size="sm"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isVerifying ? "animate-spin" : ""}`}
          />
          {isVerifying ? "Memverifikasi..." : "Verifikasi Integritas Seed"}
        </Button>
      </div>

      {/* Seed Items Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Card key={item.id} className="flex flex-col justify-between">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-md bg-muted">
                    {getCategoryIcon(item.category)}
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold">
                      {item.name}
                    </CardTitle>
                    <CardDescription className="text-xs mt-0.5">
                      Tabel: <code className="font-mono">{item.targetTable}</code>
                    </CardDescription>
                  </div>
                </div>
                <Badge
                  variant={item.status === "seeded" ? "default" : "secondary"}
                  className="text-xs capitalize"
                >
                  {item.status}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-3 pt-0">
              <p className="text-xs text-muted-foreground">
                {item.description}
              </p>

              {/* Seed Items Table/List */}
              <div className="rounded-md border bg-muted/30 p-2 space-y-1.5 text-xs">
                {item.items.map((sub) => (
                  <div
                    key={sub.key}
                    className="flex items-center justify-between gap-2 border-b border-border/40 pb-1 last:border-0 last:pb-0"
                  >
                    <span className="font-medium text-foreground">
                      {sub.label}
                    </span>
                    <span className="text-muted-foreground font-mono text-[11px] truncate max-w-[180px]">
                      {sub.value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                <span className="font-mono truncate max-w-[130px]">
                  {item.checksum}
                </span>
                <span className="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                  <Sparkles className="h-3 w-3" />
                  Idempoten
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
