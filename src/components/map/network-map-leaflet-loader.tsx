"use client";

import dynamic from "next/dynamic";
import { Loader2, MapPin, Layers } from "lucide-react";
import type { NetworkMapProps } from "./network-map";

export type NetworkMapLoaderProps = NetworkMapProps;

export function MapLoadingSkeleton({ message = "Memuat Pustaka Peta Satelit & Topologi..." }: { message?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="map-loading-indicator"
      className="flex h-[calc(100vh-140px)] min-h-[580px] w-full flex-col items-center justify-center rounded-xl border bg-card/60 backdrop-blur-xs shadow-sm text-muted-foreground gap-3.5 relative overflow-hidden"
    >
      {/* Background Animated Shimmer */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-shimmer" />

      <div className="relative flex flex-col items-center gap-3 z-10">
        <div className="relative flex items-center justify-center">
          <div className="size-12 rounded-full border border-primary/20 bg-primary/10 flex items-center justify-center">
            <Layers className="size-6 text-primary animate-pulse" />
          </div>
          <Loader2 className="size-14 text-primary animate-spin absolute" />
        </div>

        <div className="text-center space-y-1">
          <p className="text-xs font-semibold text-foreground tracking-wide flex items-center justify-center gap-1.5">
            <MapPin className="size-3.5 text-primary" />
            {message}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Menyiapkan canvas vektor Leaflet dan koordinat sentral...
          </p>
        </div>
      </div>
    </div>
  );
}

const DynamicNetworkMap = dynamic(
  () => import("./network-map").then((mod) => mod.NetworkMap),
  {
    ssr: false,
    loading: () => <MapLoadingSkeleton />,
  },
);

export function NetworkMapLeafletLoader(props: NetworkMapLoaderProps) {
  return <DynamicNetworkMap {...props} />;
}
