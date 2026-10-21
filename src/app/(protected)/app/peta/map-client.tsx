"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const DynamicMapContainer = dynamic(
  () =>
    import("@/components/peta/map-container").then((mod) => mod.MapContainer),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex flex-col items-center justify-center bg-background text-foreground gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-xs font-medium text-muted-foreground">
          Memuat Antarmuka Peta NOC...
        </p>
      </div>
    ),
  },
);

export function MapClient() {
  return (
    <main className="w-full h-full p-0 m-0 overflow-hidden relative">
      <DynamicMapContainer />
    </main>
  );
}
