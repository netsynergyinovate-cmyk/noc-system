"use client";

import { useState } from "react";
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WlanSecret {
  ssid: string;
  passphrase: string;
}
type Phase =
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "shown"; entries: WlanSecret[]; matched: boolean }
  | { kind: "error"; message: string };

const MASK = "••••••••••";

/**
 * Password Wi-Fi yang sedang dipakai modem, dibaca dari GenieACS (hanya bagian Wi-Fi, tanpa akun admin modem).
 * Awalnya tersembunyi; dibaca baru saat diminta dan dibuang dari state saat disembunyikan. Setiap pembukaan dicatat
 * server di jejak aktivitas (isi sandi tidak ikut tercatat). Bila SSID yang tampil tidak cocok dengan WLAN mana pun,
 * semua WLAN ditampilkan berlabel SSID; tidak ada yang dipilih diam-diam.
 */
export function CpeWifiPassword({ deviceId, canManage, ssid }: { deviceId: string | null; canManage: boolean; ssid?: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "hidden" });
  const [copied, setCopied] = useState<string | null>(null);

  async function reveal() {
    if (!deviceId) return;
    setPhase({ kind: "loading" });
    try {
      const res = await fetch(`/api/cpe/${encodeURIComponent(deviceId)}/secrets?scope=wifi`, { cache: "no-store" });
      if (res.status === 403) return setPhase({ kind: "error", message: "Hanya admin (izin kelola CPE) yang boleh melihat password." });
      if (res.status === 404) return setPhase({ kind: "error", message: "Modem tidak ditemukan di GenieACS." });
      if (!res.ok) return setPhase({ kind: "error", message: "GenieACS tidak dapat dihubungi." });
      const body: { data?: { wifi?: WlanSecret[] } } | null = await res.json().catch(() => null);
      const list = body?.data?.wifi ?? [];
      if (list.length === 0) {
        return setPhase({ kind: "error", message: "Modem ini tidak menyimpan password Wi-Fi yang bisa dibaca lewat GenieACS." });
      }
      const match = ssid ? list.filter((w) => w.ssid === ssid) : [];
      setPhase(match.length > 0 ? { kind: "shown", entries: match, matched: true } : { kind: "shown", entries: list, matched: false });
    } catch {
      setPhase({ kind: "error", message: "Server aplikasi tidak terjangkau." });
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard ditolak peramban: pengguna masih bisa menyalin manual dari tampilan
    }
  }

  const shown = phase.kind === "shown";
  const matched = phase.kind !== "shown" || phase.matched;
  const disabledReason = !deviceId
    ? "Modem belum terdaftar di GenieACS."
    : !canManage
      ? "Hanya admin yang boleh melihat password."
      : null;

  return (
    <div className="space-y-1.5" data-testid="cpe-wifi-password">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <KeyRound className="size-3.5" aria-hidden="true" />
        Password saat ini
      </div>
      <div className="space-y-2">
        {(shown ? phase.entries : [null]).map((entry, i) => (
          <div key={i} className="space-y-1">
            {entry && !matched && <div className="text-[11px] text-muted-foreground">SSID “{entry.ssid || "tanpa nama"}”</div>}
            <div className="flex items-center gap-2">
              <div className="flex h-9 min-w-0 flex-1 items-center rounded-md border bg-muted/30 px-3 font-mono text-sm" aria-live="polite">
                <span className="truncate">{entry ? entry.passphrase : MASK}</span>
              </div>
              {i === 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={shown ? "Sembunyikan password" : "Tampilkan password"}
                  aria-pressed={shown}
                  disabled={disabledReason !== null || phase.kind === "loading"}
                  onClick={() => (shown ? setPhase({ kind: "hidden" }) : void reveal())}
                >
                  {phase.kind === "loading" ? <Loader2 className="size-4 animate-spin" /> : shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              )}
              {entry && (
                <Button type="button" variant="outline" size="icon" aria-label="Salin password" onClick={() => void copy(entry.passphrase)}>
                  {copied === entry.passphrase ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {shown && !matched && (
        <p role="status" className="text-xs text-warning">
          Nama WiFi yang tampil tidak cocok dengan WLAN yang terbaca di modem, jadi semua WLAN ditampilkan.
        </p>
      )}
      {phase.kind === "error" && (
        <p role="alert" className="text-xs text-destructive">
          {phase.message}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        {disabledReason ?? "Tersembunyi sampai dibuka. Setiap pembukaan dicatat di jejak aktivitas."}
      </p>
    </div>
  );
}
