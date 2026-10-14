import Link from "next/link";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActiveAlert } from "@/lib/dashboard/alerts";
import { mapFocusHref } from "@/lib/dashboard/map-focus";

// Tombol sorot: membuka dashboard dengan peta yang langsung bergeser ke
// pelanggan itu (tautan ?focus=, lihat MapFocusFromUrl). Hanya alert yang punya
// titik; alert router tidak, dan itu ditulis, bukan dibiarkan kosong.
export function HighlightOnMap({
  alert,
}: {
  alert: Pick<ActiveAlert, "customerId" | "location">;
}) {
  const { latitude, longitude } = alert.location;
  const href =
    alert.customerId === null ? null : mapFocusHref(alert.customerId);
  if (href === null || latitude === null || longitude === null) {
    return (
      <span className="text-xs text-muted-foreground">Tidak ada titik</span>
    );
  }
  return (
    <Button variant="outline" size="sm" asChild>
      <Link href={href} aria-label={`Sorot ${alert.location.name} di peta`}>
        <MapPin aria-hidden="true" />
        Sorot di peta
      </Link>
    </Button>
  );
}
