"use client";

import Link from "next/link";
import { MessageSquare, Clock, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function WhatsappSettings() {
  return (
    <Card className="border border-border/60 bg-card shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <MessageSquare className="size-4 text-emerald-500" />
              <span>Integrasi Gateway WhatsApp</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Konfigurasi broadcast alert insiden jaringan via WhatsApp ke nomor
              darurat teknisi NOC.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold px-2.5 py-0.5 text-xs flex items-center gap-1.5"
          >
            <Clock className="size-3" />
            <span>Coming Soon</span>
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-1">
        <div className="rounded-lg border border-border/60 bg-muted/20 p-4 text-xs text-muted-foreground space-y-2">
          <p className="leading-relaxed">
            Integrasi gateway WhatsApp otomatis (Fonnte, Wablas, Whacenter)
            sedang dalam tahap pengembangan (Coming Soon) dan akan langsung
            dihubungkan dengan background worker alert engine.
          </p>
          <p className="leading-relaxed text-foreground/80">
            Setelah aktif, setiap insiden berstatus kritis atau darurat akan
            otomatis diteruskan ke nomor ponsel tim lapangan secara instan.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <Link
            href="/app/alert/whatsapp/penerima"
            className="text-xs text-primary font-medium hover:underline inline-flex items-center gap-1"
          >
            <span>Kelola penerima di halaman khusus</span>
            <ArrowRight className="size-3" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
