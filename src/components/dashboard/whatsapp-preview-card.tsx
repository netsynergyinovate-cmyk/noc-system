"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  renderWhatsappMessage,
  templateVariables,
} from "@/lib/dashboard/whatsapp";
import {
  parseWhatsappFormat,
  previewScenarios,
  usedTemplateVariables,
} from "@/lib/dashboard/whatsapp-preview";

export function WhatsappPreviewCard({ template }: { template: string }) {
  const [scenarioId, setScenarioId] = useState(previewScenarios[0].id);
  const scenario =
    previewScenarios.find((s) => s.id === scenarioId) ?? previewScenarios[0];
  const text = renderWhatsappMessage(template, scenario.alert);
  const used = usedTemplateVariables(template, templateVariables);

  return (
    <Card data-testid="whatsapp-preview-card" className="gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <MessageCircle className="size-4 text-success" aria-hidden />
          Pratinjau Pesan WhatsApp
        </CardTitle>
        <Badge variant="secondary">Simulasi Pratinjau</Badge>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <div
          role="group"
          aria-label="Skenario gangguan"
          className="flex flex-wrap gap-1.5"
        >
          {previewScenarios.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === scenario.id}
              onClick={() => setScenarioId(s.id)}
              className="rounded-full border px-3 py-1 text-xs aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="rounded-lg bg-secondary/60 p-3">
          <div className="ml-auto max-w-[90%] rounded-lg rounded-tr-none bg-green-100 px-3 py-2 text-green-950 shadow-xs dark:bg-green-900 dark:text-green-50">
            <p
              data-testid="whatsapp-preview"
              className="whitespace-pre-wrap break-words font-sans text-sm"
            >
              {parseWhatsappFormat(text).map((seg, i) =>
                seg.type === "bold" ? (
                  <strong key={i}>{seg.text}</strong>
                ) : seg.type === "italic" ? (
                  <em key={i}>{seg.text}</em>
                ) : seg.type === "strike" ? (
                  <s key={i}>{seg.text}</s>
                ) : (
                  seg.text
                ),
              )}
            </p>
            <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70">
              <span>10:00</span>
              <span
                aria-label="Terkirim dan dibaca"
                className="text-sky-600 dark:text-sky-300"
              >
                ✓✓
              </span>
            </div>
          </div>
        </div>

        <dl className="space-y-1 text-xs text-muted-foreground">
          <div className="flex gap-1">
            <dt>Panjang pesan:</dt>
            <dd data-testid="whatsapp-preview-chars">{text.length} karakter</dd>
          </div>
          <div className="flex flex-wrap gap-1">
            <dt>Variabel aktif:</dt>
            <dd data-testid="whatsapp-preview-vars" className="font-mono">
              {used.length ? used.map((v) => `{${v}}`).join(" ") : "tidak ada"}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
