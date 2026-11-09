"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Ban,
  BellRing,
  ChevronDown,
  ChevronUp,
  WifiOff,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type {
  HierarchyTreeNode,
  MapCustomer,
  MapDevice,
} from "@/services/map/types";
import { capacityUse } from "@/services/map/loss-budget";
import { DEVICE_TYPE_STYLE } from "./map-style";

interface AlertWidgetProps {
  customers: MapCustomer[];
  devices: MapDevice[];
  /** Buka detail dan geser peta ke titiknya (sama dengan pohon hierarki) */
  onSelect: (node: HierarchyTreeNode) => void;
}

type Group = {
  key: string;
  label: string;
  color: string;
  Icon: LucideIcon;
  items: { node: HierarchyTreeNode; sub: string }[];
};

const customerNode = (c: MapCustomer): HierarchyTreeNode => ({
  id: c.id,
  name: c.name,
  type: "customer",
  latitude: c.latitude ?? undefined,
  longitude: c.longitude ?? undefined,
  status: c.status ?? "unknown",
  children: [],
});

// Ringkasan masalah jaringan dari data peta: pelanggan loss/isolir/offline dan ODP/ODC penuh
export function AlertWidget({
  customers,
  devices,
  onSelect,
}: AlertWidgetProps) {
  const [open, setOpen] = useState(false);
  const [group, setGroup] = useState<string | null>(null);

  const byStatus = (status: MapCustomer["status"]) =>
    customers
      .filter((c) => c.status === status)
      .map((c) => ({ node: customerNode(c), sub: c.customerNumber }));
  const full = devices.flatMap((d) => {
    const use = capacityUse(d, devices);
    return use && use.used >= use.total
      ? [
          {
            node: {
              id: d.id,
              name: d.name,
              type: d.type,
              latitude: d.latitude,
              longitude: d.longitude,
              status: d.status,
              children: [],
            } satisfies HierarchyTreeNode,
            sub: `${DEVICE_TYPE_STYLE[d.type]?.name ?? d.type} • ${use.used}/${use.total} port`,
          },
        ]
      : [];
  });

  const groups: Group[] = [
    {
      key: "loss",
      label: "Loss / Gangguan",
      color: "#ef4444",
      Icon: XCircle,
      items: byStatus("loss"),
    },
    {
      key: "isolir",
      label: "Isolir",
      color: "#eab308",
      Icon: Ban,
      items: byStatus("isolir"),
    },
    {
      key: "offline",
      label: "Offline",
      color: "#71717a",
      Icon: WifiOff,
      items: byStatus("offline"),
    },
    {
      key: "full",
      label: "ODP/ODC penuh",
      color: "#ef4444",
      Icon: AlertTriangle,
      items: full,
    },
  ];
  const total = groups.reduce((sum, g) => sum + g.items.length, 0);
  const urgent = groups[0].items.length + groups[3].items.length;

  return (
    <div className="bg-card/95 backdrop-blur-md border border-border shadow-lg rounded-xl overflow-hidden text-card-foreground text-xs pointer-events-auto max-w-[280px]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-1.5 font-semibold text-foreground">
          <BellRing
            className={`w-3.5 h-3.5 ${urgent ? "text-rose-500" : "text-primary"}`}
          />
          Peringatan Jaringan
          {total > 0 && (
            <span
              className={`px-1.5 rounded-full text-[10px] font-bold text-white ${urgent ? "bg-rose-500" : "bg-zinc-500"}`}
            >
              {total}
            </span>
          )}
        </span>
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="border-t border-border bg-card/60 p-2 space-y-1">
          {groups.map((g) => {
            const expanded = group === g.key;
            return (
              <div key={g.key}>
                <button
                  type="button"
                  disabled={g.items.length === 0}
                  onClick={() => setGroup(expanded ? null : g.key)}
                  aria-expanded={expanded}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-muted disabled:opacity-50 disabled:hover:bg-transparent"
                >
                  <span className="flex items-center gap-1.5 text-foreground">
                    <g.Icon
                      aria-hidden
                      className="w-3.5 h-3.5"
                      style={{ color: g.color }}
                      strokeWidth={2.5}
                    />
                    {g.label}
                  </span>
                  <span
                    className="font-mono font-bold"
                    style={{ color: g.items.length ? g.color : undefined }}
                  >
                    {g.items.length}
                  </span>
                </button>
                {expanded && (
                  <ul className="max-h-48 overflow-y-auto pl-6 pr-1 py-1 space-y-0.5">
                    {g.items.map(({ node, sub }) => (
                      <li key={node.id}>
                        <button
                          type="button"
                          onClick={() => onSelect(node)}
                          className="w-full text-left px-2 py-1 rounded hover:bg-muted"
                        >
                          <span className="block text-foreground truncate">
                            {node.name}
                          </span>
                          <span className="block font-mono text-[10px] text-muted-foreground truncate">
                            {sub}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
