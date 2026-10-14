"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, HelpCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SETUP_PAGE_TIPS } from "@/lib/dashboard/setup-extended";

const ICONS = {
  "cara-kerja": HelpCircle,
  "masalah-umum": AlertTriangle,
  solusi: CheckCircle2,
} as const;

export function SetupTipsPanel() {
  const [open, setOpen] = useState<string | null>("cara-kerja");

  return (
    <Card data-testid="setup-tips-panel" className="gap-0 py-0">
      <CardContent className="flex flex-col divide-y p-0">
        {SETUP_PAGE_TIPS.map((group) => {
          const Icon = ICONS[group.id];
          const isOpen = open === group.id;
          const panelId = `tips-${group.id}`;
          return (
            <section key={group.id}>
              <h2 className="text-base font-semibold">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpen(isOpen ? null : group.id)}
                  className="flex w-full items-center gap-2 px-5 py-3 text-left"
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="flex-1">{group.title}</span>
                  <ChevronDown
                    className={`size-4 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              </h2>
              <div id={panelId} hidden={!isOpen} className="px-5 pb-4">
                <ul className="space-y-2 text-sm leading-6">
                  {group.items.map((item) => (
                    <li key={item.title}>
                      <span className="font-medium">{item.title}: </span>
                      <span className="text-muted-foreground">{item.body}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
