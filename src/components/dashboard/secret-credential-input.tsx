"use client";

import { useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface SecretCredentialInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  hasStoredSecret?: boolean;
  envKey?: string;
  label?: string;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  autoComplete?: "new-password" | "current-password";
}

/**
 * Isian kata sandi perangkat. Nilai tersimpan TIDAK PERNAH dimuat ke sini:
 * field selalu mulai kosong; kosong berarti "pertahankan yang tersimpan".
 */
export function SecretCredentialInput({
  id,
  value,
  onChange,
  hasStoredSecret = false,
  envKey,
  label = "Kata sandi",
  placeholder,
  error,
  disabled = false,
  autoComplete = "new-password",
}: SecretCredentialInputProps) {
  const [showSecret, setShowSecret] = useState(false);
  const statusId = `${id}-status`;
  const helpId = `${id}-help`;
  const errorId = `${id}-err`;
  const describedBy =
    [hasStoredSecret && statusId, hasStoredSecret && helpId, error && errorId]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {hasStoredSecret && (
          <span
            id={statusId}
            data-testid="stored-secret-status"
            className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          >
            <KeyRound className="size-3" aria-hidden="true" />
            {envKey ? `Tersimpan via ENV ${envKey}` : "Terkonfigurasi ••••••••"}
          </span>
        )}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={showSecret ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            placeholder ??
            (hasStoredSecret
              ? "Kosongkan untuk mempertahankan kata sandi tersimpan"
              : "Masukkan kata sandi baru")
          }
          autoComplete={autoComplete}
          spellCheck={false}
          autoCapitalize="none"
          disabled={disabled}
          className="pr-11"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-0.5 right-0.5 text-muted-foreground"
          aria-label="Tampilkan kata sandi"
          aria-pressed={showSecret}
          disabled={!value || disabled}
          onClick={() => setShowSecret((shown) => !shown)}
        >
          {showSecret ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </div>
      {hasStoredSecret && (
        <p id={helpId} className="text-xs text-muted-foreground">
          Kata sandi lama tetap digunakan jika isian ini dikosongkan.
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
