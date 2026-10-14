"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getThemePreference,
  setThemePreference,
  subscribeTheme,
  type ThemePreference,
} from "@/lib/theme";

const options: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Tema terang", Icon: Sun },
  { value: "dark", label: "Tema gelap", Icon: Moon },
  { value: "system", label: "Ikuti tema sistem", Icon: Monitor },
];

export function ThemeToggle() {
  const preference = useSyncExternalStore(
    subscribeTheme,
    getThemePreference,
    () => "system" as const,
  );
  return (
    <div role="group" aria-label="Tema tampilan" className="flex gap-1">
      {options.map(({ value, label, Icon }) => (
        <Button
          key={value}
          type="button"
          variant={preference === value ? "secondary" : "ghost"}
          size="icon-sm"
          aria-label={label}
          aria-pressed={preference === value}
          title={label}
          onClick={() => setThemePreference(value)}
        >
          <Icon aria-hidden="true" />
        </Button>
      ))}
    </div>
  );
}
