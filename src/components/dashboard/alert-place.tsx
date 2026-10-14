import { MapPin, MapPinOff } from "lucide-react";
import { describeLocation, type AlertLocation } from "@/lib/dashboard/alerts";

// Di mana kejadiannya: ODP atau nama router di baris utama, alamat di bawahnya.
// Ikon dan teks (bukan warna) memberi tahu apakah ada titik di peta.
export function AlertPlace({ location }: { location: AlertLocation }) {
  const { primary, secondary, hasPoint } = describeLocation(location);
  const Icon = hasPoint ? MapPin : MapPinOff;
  return (
    <span className="inline-flex flex-col" data-has-point={hasPoint}>
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Icon
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        {primary}
        <span className="sr-only">
          {hasPoint ? " (ada titik di peta)" : " (tidak ada titik di peta)"}
        </span>
      </span>
      {secondary && (
        <span className="text-xs text-muted-foreground">{secondary}</span>
      )}
    </span>
  );
}
