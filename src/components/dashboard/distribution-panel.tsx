"use client";

import dynamic from "next/dynamic";
import { cn } from "cn";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatInteger } from "@/lib/dashboard/format";
import { useDashboardStore } from "@/lib/dashboard/store";

// Leaflet butuh `window`, jadi peta hanya dimuat di browser.
const CustomerMap = dynamic(
  () => import("./customer-map").then((module) => module.CustomerMap),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-72 animate-pulse rounded-lg bg-muted motion-reduce:animate-none"
        aria-hidden="true"
      />
    ),
  },
);

function LegendRow({
  label,
  count,
  dotClassName,
}: {
  label: string;
  count: number;
  dotClassName: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="flex items-center gap-2">
        <span
          className={cn("size-2.5 rounded-full", dotClassName)}
          aria-hidden="true"
        />
        {label}
      </span>
      <span className="font-medium tabular-nums">{formatInteger(count)}</span>
    </li>
  );
}

export function DistributionPanel({ className }: { className?: string }) {
  const online = useDashboardStore((state) => state.onlineCount);
  const offline = useDashboardStore((state) => state.offlineCount);
  const weak = useDashboardStore((state) => state.weakSignalCount);

  return (
    <Card className={className}>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-base font-semibold">Sebaran pelanggan</CardTitle>
        <CardDescription className="text-xs">
          Hijau normal, kuning perlu dicek, merah offline
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0 flex flex-col gap-3">
        <div
          role="region"
          aria-label="Peta sebaran pelanggan"
          className="isolate overflow-hidden rounded-lg border"
        >
          <CustomerMap />
        </div>
        <ul className="flex flex-col gap-2.5">
          <LegendRow
            label="Normal"
            count={online - weak}
            dotClassName="bg-success"
          />
          <LegendRow
            label="Sinyal lemah"
            count={weak}
            dotClassName="bg-warning"
          />
          <LegendRow
            label="Offline"
            count={offline}
            dotClassName="bg-destructive"
          />
        </ul>
      </CardContent>
    </Card>
  );
}
