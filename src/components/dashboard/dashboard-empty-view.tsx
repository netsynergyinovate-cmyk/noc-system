"use client";

import Link from "next/link";
import { FilterX, RouterIcon, Users, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type {
  DashboardEmptyReason,
  DashboardEmptyStateConfig,
} from "@/lib/dashboard/dashboard-empty-state";

const icons: Record<DashboardEmptyReason, typeof Users> = {
  no_router_connected: RouterIcon,
  no_customers_found: Users,
  filtered_empty: FilterX,
  connection_lost: WifiOff,
};

export function DashboardEmptyView({
  config,
  onAction,
}: {
  config: DashboardEmptyStateConfig;
  // Dipakai bila aksi bukan tautan (Reset filter, Sambungkan Ulang).
  onAction?: () => void;
}) {
  const Icon = icons[config.reason];
  return (
    <Card
      data-testid="dashboard-empty-view"
      data-empty-reason={config.reason}
      role="status"
    >
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <Icon className="size-10 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-base font-semibold">{config.title}</h3>
        <p className="max-w-md text-sm text-muted-foreground">
          {config.description}
        </p>
        {config.guidanceTips.length > 0 && (
          <ul className="max-w-md list-disc space-y-1 pl-5 text-left text-xs text-muted-foreground">
            {config.guidanceTips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        )}
        {config.actionLabel &&
          (config.actionHref ? (
            <Button asChild size="sm" className="mt-1">
              {config.isActionExternal ? (
                <a href={config.actionHref}>{config.actionLabel}</a>
              ) : (
                <Link href={config.actionHref}>{config.actionLabel}</Link>
              )}
            </Button>
          ) : (
            onAction && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={onAction}
              >
                {config.actionLabel}
              </Button>
            )
          ))}
      </CardContent>
    </Card>
  );
}
